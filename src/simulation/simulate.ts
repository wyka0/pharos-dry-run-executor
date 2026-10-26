/**
 * Transaction simulation for the Dry-Run Executor.
 *
 * Simulates execution with eth_call (via viem `call`). Nothing is ever
 * broadcast: no eth_sendTransaction, no eth_sendRawTransaction, no signing.
 *
 * A returned result is a *prediction*, not a confirmation. Simulation does
 * not guarantee future transaction success.
 */

import { classifyRpcError } from '../rpc/errors.js';
import type { RpcLike } from '../rpc/client.js';
import { describeRevertData } from './decode-revert.js';
import type { TransactionInput } from '../types.js';

export type CallOutcome =
  | { status: 'SUCCESS'; returnData: `0x${string}` | null }
  | { status: 'REVERTED'; revertData: `0x${string}` | null; decodedReason: string }
  | { status: 'ERROR'; failureKind: 'RPC'; message: string };

/** Builds eth_call arguments from validated input. */
export function buildCallArgs(input: TransactionInput): {
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
 * Simulates the transaction via eth_call and classifies the outcome.
 * Never throws for tx-level failures; infrastructure errors are reported
 * with status ERROR / failureKind RPC so they are never mistaken for a
 * contract revert.
 */
export async function simulateCall(client: RpcLike, input: TransactionInput): Promise<CallOutcome> {
  try {
    const res = await client.call(buildCallArgs(input));
    return { status: 'SUCCESS', returnData: res.data ?? null };
  } catch (err) {
    const classified = classifyRpcError(err);
    if (classified.kind === 'RPC') {
      return {
        status: 'ERROR',
        failureKind: 'RPC',
        message: `RPC error during simulation (no simulation performed): ${classified.message}`,
      };
    }
    // Execution-level failure of the simulated transaction: a revert.
    const { displayReason } = describeRevertData(classified.revertData);
    return {
      status: 'REVERTED',
      revertData: classified.revertData,
      decodedReason: displayReason,
    };
  }
}
