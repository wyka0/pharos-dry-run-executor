/**
 * Dry-Run Executor — public API and main pipeline.
 *
 * Flow: validate → verify network → simulate (eth_call) → estimate gas →
 * compute cost → analyze expected outcome → execution guard (GO / NO_GO).
 *
 * SAFETY: this pipeline is simulation-only end to end. It calls only
 * read-only RPC methods (eth_chainId, eth_blockNumber, eth_getBalance,
 * eth_gasPrice, eth_call, eth_estimateGas). It never signs and never
 * broadcasts. A GO decision means the simulation passed — no transaction
 * is ever sent.
 */

import { initConfig, type ExecutorConfig } from './config.js';
import { createRpcClient, verifyNetwork, type RpcLike } from './rpc/client.js';
import {
  computeContractCallOutcome,
  computeNativeTransferOutcome,
  isNativeTransfer,
  readBalances,
} from './analysis/balance-diff.js';
import { evaluateExecutionGuard } from './execution/execution-guard.js';
import { estimateGasAndPrice } from './simulation/estimate-gas.js';
import { simulateCall } from './simulation/simulate.js';
import { describeRevertData } from './simulation/decode-revert.js';
import { validateTransaction } from './validation/transaction.js';
import type {
  DryRunReport,
  GasEstimate,
  NetworkInfo,
  RawTransactionRequest,
  SimulationResult,
} from './types.js';

export { initConfig, loadConfig } from './config.js';
export { createRpcClient, verifyNetwork, pharosAtlantic } from './rpc/client.js';
export { RpcUnavailableError, RpcResponseError, classifyRpcError } from './rpc/errors.js';
export {
  decodeRevertData,
  describeRevertData,
  REASON_UNAVAILABLE,
} from './simulation/decode-revert.js';
export {
  calculateGasCostWei,
  calculateCost,
  formatPhrs,
  formatGwei,
  weiToDecimalUnits,
} from './simulation/calculate-cost.js';
export { estimateGasAndPrice } from './simulation/estimate-gas.js';
export { simulateCall } from './simulation/simulate.js';
export { validateTransaction, parsePhrsToWei, parseWei } from './validation/transaction.js';
export {
  computeNativeTransferOutcome,
  computeContractCallOutcome,
  readBalances,
  isNativeTransfer,
  PREDICTED_LABEL,
  STATE_CHANGES_NOTE,
} from './analysis/balance-diff.js';
export { renderReport, renderJson } from './analysis/report.js';
export {
  evaluateExecutionGuard,
  GO_MESSAGE,
  NO_GO_MESSAGE,
} from './execution/execution-guard.js';
export type { RpcLike } from './rpc/client.js';
export type { ExecutorConfig } from './config.js';
export * from './types.js';

export interface DryRunOptions {
  /** Pre-loaded config (defaults to .env / environment). */
  config?: ExecutorConfig;
  /** Injected RPC client (used by tests); defaults to a real viem client. */
  client?: RpcLike;
}

function validationErrorMessage(issues: { field: string; message: string }[]): string {
  return issues.map((i) => `[${i.field}] ${i.message}`).join(' ');
}

function unverifiedNetwork(config: ExecutorConfig, error: string | null): NetworkInfo {
  return {
    chainId: config.chainId,
    chainName: config.chainName,
    rpcUrl: config.rpcUrl,
    ...(config.explorerUrl !== undefined ? { explorerUrl: config.explorerUrl } : {}),
    blockNumber: null,
    verified: false,
    verificationError: error ?? 'Network not verified.',
  };
}

/**
 * Runs the full dry-run pipeline for a raw transaction request.
 * Never throws for transaction-level problems — failures are returned as
 * SimulationResult (status ERROR) and always produce a NO_GO guard.
 */
export async function runDryRun(
  raw: RawTransactionRequest,
  options: DryRunOptions = {},
): Promise<DryRunReport> {
  const startedAtIso = new Date().toISOString();
  const config = options.config ?? initConfig();

  // ---- 1. Validation (no RPC calls for invalid input) ----
  const validation = validateTransaction(raw);
  if (!validation.ok) {
    const result: SimulationResult = {
      status: 'ERROR',
      complete: false,
      network: unverifiedNetwork(config, 'Not reached — input validation failed first.'),
      input: {
        from: '0x0000000000000000000000000000000000000000',
        to: '0x0000000000000000000000000000000000000000',
        valueWei: 0n,
        data: '0x',
      },
      description: typeof raw.description === 'string' ? raw.description : null,
      returnData: null,
      gasEstimate: null,
      gasEstimateError: null,
      revert: null,
      failureKind: 'VALIDATION',
      rawError: validationErrorMessage(validation.issues),
      validationIssues: validation.issues,
      balanceReads: null,
      outcome: null,
      warnings: [],
      startedAtIso,
      finishedAtIso: new Date().toISOString(),
      simulationOnly: true,
    };
    return { result, guard: evaluateExecutionGuard(result) };
  }
  const input = validation.value;

  // ---- 2. Network verification (read-only) ----
  const client = options.client ?? (createRpcClient(config) as unknown as RpcLike);
  const verification = await verifyNetwork(client, config);
  const network: NetworkInfo = {
    chainId: verification.chainId ?? config.chainId,
    chainName: config.chainName,
    rpcUrl: config.rpcUrl,
    ...(config.explorerUrl !== undefined ? { explorerUrl: config.explorerUrl } : {}),
    blockNumber: verification.blockNumber,
    verified: verification.verified,
    verificationError: verification.error,
  };

  const fail = (
    partial: Partial<SimulationResult>,
  ): DryRunReport => {
    const result: SimulationResult = {
      status: 'ERROR',
      complete: false,
      network,
      input,
      description: input.description ?? null,
      returnData: null,
      gasEstimate: null,
      gasEstimateError: null,
      revert: null,
      failureKind: 'RPC',
      rawError: null,
      validationIssues: [],
      balanceReads: null,
      outcome: null,
      warnings: [],
      startedAtIso,
      finishedAtIso: new Date().toISOString(),
      simulationOnly: true,
      ...partial,
    };
    return { result, guard: evaluateExecutionGuard(result) };
  };

  if (!verification.verified) {
    return fail({
      failureKind: 'RPC',
      rawError: verification.error,
      warnings: ['Simulation skipped: RPC endpoint did not verify. No results are fabricated.'],
    });
  }

  // ---- 3. Simulation via eth_call (read-only) ----
  const callOutcome = await simulateCall(client, input);
  if (callOutcome.status === 'ERROR') {
    return fail({
      failureKind: callOutcome.failureKind,
      rawError: callOutcome.message,
      warnings: ['Simulation could not run: RPC error. This is not a contract revert.'],
    });
  }

  // ---- 4. Gas estimation + cost ----
  const gasOutcome = await estimateGasAndPrice(client, input);
  let gasEstimate: GasEstimate | null = null;
  let gasEstimateError: string | null = null;
  if (gasOutcome.ok) {
    gasEstimate = {
      gasLimit: gasOutcome.gasLimit,
      gasPriceWei: gasOutcome.gasPriceWei,
      gasCostWei: gasOutcome.gasCostWei,
      gasCostPhrs: gasOutcome.gasCostPhrs,
      feeAssumptions: gasOutcome.feeAssumptions,
    };
  } else {
    gasEstimateError = gasOutcome.message;
  }

  // ---- 5. Expected-outcome analysis ----
  const warnings: string[] = [];
  if (callOutcome.status === 'REVERTED') {
    warnings.push('Expected-state analysis skipped: the transaction reverts.');
  }

  const balanceReads =
    callOutcome.status === 'REVERTED' || callOutcome.status === 'SUCCESS'
      ? await readBalances(client, input)
      : null;

  let outcome = null as SimulationResult['outcome'];
  if (callOutcome.status === 'SUCCESS') {
    if (isNativeTransfer(input)) {
      if (
        balanceReads !== null &&
        balanceReads.senderWei !== null &&
        balanceReads.recipientWei !== null &&
        gasEstimate !== null
      ) {
        outcome = computeNativeTransferOutcome(
          input,
          balanceReads.senderWei,
          balanceReads.recipientWei,
          gasEstimate.gasCostWei,
        );
        for (const w of outcome.warnings) warnings.push(w);
      } else {
        warnings.push(
          'Balance prediction skipped: sender/recipient balances or gas cost unavailable.',
        );
      }
    } else {
      outcome = computeContractCallOutcome(input);
      // Contract calls still need gas (and any attached value) to be payable.
      if (
        balanceReads !== null &&
        balanceReads.senderWei !== null &&
        gasEstimate !== null &&
        balanceReads.senderWei < input.valueWei + gasEstimate.gasCostWei
      ) {
        warnings.push(
          `Sender balance (${balanceReads.senderWei} wei) does not cover value + estimated gas ` +
            `(${(input.valueWei + gasEstimate.gasCostWei).toString()} wei).`,
        );
      }
    }
  }

  // ---- 6. Completeness (uncertainty fails closed) ----
  const complete =
    verification.verified &&
    (callOutcome.status === 'SUCCESS' || callOutcome.status === 'REVERTED') &&
    gasEstimate !== null &&
    (callOutcome.status === 'REVERTED' || outcome !== null) &&
    (outcome === null || outcome.kind !== 'NATIVE_TRANSFER' || outcome.sufficientFunds);

  const result: SimulationResult = {
    status: callOutcome.status,
    complete,
    network,
    input,
    description: input.description ?? null,
    returnData: callOutcome.status === 'SUCCESS' ? callOutcome.returnData : null,
    gasEstimate,
    gasEstimateError,
    revert:
      callOutcome.status === 'REVERTED'
        ? { revertData: callOutcome.revertData, ...describeRevertData(callOutcome.revertData) }
        : null,
    failureKind: null,
    rawError: null,
    validationIssues: [],
    balanceReads,
    outcome,
    warnings,
    startedAtIso,
    finishedAtIso: new Date().toISOString(),
    simulationOnly: true,
  };

  return { result, guard: evaluateExecutionGuard(result) };
}
