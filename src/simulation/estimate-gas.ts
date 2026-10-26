/**
 * Gas estimation for the Dry-Run Executor.
 *
 * Uses eth_estimateGas (via viem estimateGas) and eth_gasPrice. No
 * transaction is ever sent. Failures are classified so a gas estimation
 * failure is never confused with an RPC outage or a contract revert.
 */

import { FEE_NOTE_ETH_GAS_PRICE, calculateCost } from './calculate-cost.js';
import { classifyRpcError, describeError } from '../rpc/errors.js';
import type { RpcLike } from '../rpc/client.js';
import type { TransactionInput } from '../types.js';

export type GasEstimateOutcome =
  | {
      ok: true;
      gasLimit: bigint;
      gasPriceWei: bigint;
      gasCostWei: bigint;
      gasCostPhrs: string;
      feeAssumptions: { method: string; gasPriceWei: bigint; note: string };
    }
  | { ok: false; failureKind: 'GAS_ESTIMATION' | 'RPC'; message: string };

/** True when a user supplied an explicit gas limit. */
function buildCallArgs(input: TransactionInput): {
  account: `0x${string}`;
  to: `0x${string}`;
  value: bigint;
  data: `0x${string}`;
  gas?: bigint;
} {
  return {
    account: input.from,
    to: input.to,
    value: input.valueWei,
    data: input.data,
    ...(input.gasLimit !== undefined ? { gas: input.gasLimit } : {}),
  };
}

/**
 * Estimates gas and gas price, then computes the wei cost.
 * Returns a structured outcome; never throws for tx-level failures.
 */
export async function estimateGasAndPrice(
  client: RpcLike,
  input: TransactionInput,
): Promise<GasEstimateOutcome> {
  let gasLimit: bigint;
  let gasLimitSource: string;

  if (input.gasLimit !== undefined) {
    // User-supplied gas limit is used as-is (never silently replaced).
    gasLimit = input.gasLimit;
    gasLimitSource = 'user-supplied gas limit';
  } else {
    try {
      gasLimit = await client.estimateGas(buildCallArgs(input));
      gasLimitSource = 'eth_estimateGas';
    } catch (err) {
      const c = classifyRpcError(err);
      return {
        ok: false,
        failureKind: c.kind === 'RPC' ? 'RPC' : 'GAS_ESTIMATION',
        message:
          c.kind === 'RPC'
            ? `Gas estimation failed: RPC error (${c.message})`
            : `Gas estimation failed: the transaction is unlikely to execute (${c.message})`,
      };
    }
  }

  let gasPriceWei: bigint;
  try {
    gasPriceWei = await client.getGasPrice();
  } catch (err) {
    return {
      ok: false,
      failureKind: 'RPC',
      message: `Gas price lookup failed (eth_gasPrice): ${describeError(err)}`,
    };
  }

  const cost = calculateCost(gasLimit, gasPriceWei, {
    method: gasLimitSource === 'user-supplied gas limit' ? 'eth_gasPrice + user gasLimit' : 'eth_estimateGas + eth_gasPrice',
    note: FEE_NOTE_ETH_GAS_PRICE,
  });

  return {
    ok: true,
    gasLimit,
    gasPriceWei,
    gasCostWei: cost.gasCostWei,
    gasCostPhrs: cost.gasCostPhrs,
    feeAssumptions: cost.feeAssumptions,
  };
}
