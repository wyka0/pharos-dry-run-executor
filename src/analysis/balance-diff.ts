/**
 * Expected-outcome analysis for the Dry-Run Executor.
 *
 * For a plain native PHRS transfer: reads sender/recipient balances via
 * eth_getBalance and predicts balances after value + estimated gas cost,
 * using BigInt only. Predicted values are clearly labeled
 * "PREDICTED — NOT CONFIRMED" at render time.
 *
 * For contract calls, eth_call cannot reveal storage changes; the analysis
 * states that state changes are not fully available from simulation.
 */

import type { RpcLike } from '../rpc/client.js';
import { describeError } from '../rpc/errors.js';
import type {
  BalanceReads,
  ContractCallAnalysis,
  NativeTransferAnalysis,
  TransactionInput,
} from '../types.js';

export const PREDICTED_LABEL = 'PREDICTED — NOT CONFIRMED' as const;
export const STATE_CHANGES_NOTE = 'State changes not fully available from simulation' as const;

/** Reads current balances via eth_getBalance. Best-effort; errors are collected. */
export async function readBalances(
  client: RpcLike,
  input: TransactionInput,
): Promise<BalanceReads> {
  const reads: BalanceReads = { senderWei: null, recipientWei: null, errors: [] };
  const jobs: Array<{ key: 'senderWei' | 'recipientWei'; address: `0x${string}` }> = [
    { key: 'senderWei', address: input.from },
    { key: 'recipientWei', address: input.to },
  ];
  await Promise.all(
    jobs.map(async (job) => {
      try {
        const bal = await client.getBalance({ address: job.address });
        reads[job.key] = bal;
      } catch (err) {
        reads.errors.push(
          `eth_getBalance failed for ${job.address}: ${describeError(err)}`,
        );
      }
    }),
  );
  return reads;
}

/** True when the tx is a plain native transfer (no calldata). */
export function isNativeTransfer(input: TransactionInput): boolean {
  return input.data === '0x';
}

/**
 * Computes the predicted balance changes for a native transfer.
 * Requires both balances and a gas cost estimate; returns null when the
 * prediction cannot be reliably derived.
 */
export function computeNativeTransferOutcome(
  input: TransactionInput,
  senderBalanceWei: bigint,
  recipientBalanceWei: bigint,
  gasCostWei: bigint,
): NativeTransferAnalysis {
  const totalDebit = input.valueWei + gasCostWei;
  const sufficientFunds = senderBalanceWei >= totalDebit;
  const warnings: string[] = [];
  let predictedSender: bigint | null = senderBalanceWei - totalDebit;
  if (!sufficientFunds) {
    warnings.push(
      `Sender balance (${senderBalanceWei} wei) does not cover value + estimated gas cost ` +
        `(${totalDebit} wei). Some nodes do not enforce balance in eth_call, so a SUCCESS ` +
        'simulation here does not mean the transaction would succeed when actually sent.',
    );
    predictedSender = null;
  }
  return {
    kind: 'NATIVE_TRANSFER',
    senderBalanceBeforeWei: senderBalanceWei,
    recipientBalanceBeforeWei: recipientBalanceWei,
    transferValueWei: input.valueWei,
    gasCostWei,
    predictedSenderBalanceAfterWei: predictedSender,
    predictedRecipientBalanceAfterWei: recipientBalanceWei + input.valueWei,
    sufficientFunds,
    warnings,
  };
}

/** Builds the contract-call analysis placeholder. */
export function computeContractCallOutcome(input: TransactionInput): ContractCallAnalysis {
  return {
    kind: 'CONTRACT_CALL',
    target: input.to,
    calldata: input.data,
    note: STATE_CHANGES_NOTE,
  };
}
