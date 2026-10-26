/**
 * Live testnet transaction — pre-broadcast checks (read-only RPC).
 *
 * Verifies, before anything is shown for confirmation:
 *   - the RPC reports chain ID 688689 (hard-locked to Pharos Atlantic Testnet)
 *   - the transaction can be gas-estimated
 *   - the current gas price
 *   - the sender holds enough native PHRS for amount + estimated fee
 */

import type { RpcLike } from '../rpc/client.js';

export interface PreflightResult {
  chainId: number | null;
  blockNumber: bigint | null;
  senderBalanceWei: bigint | null;
  estimatedGas: bigint | null;
  gasPriceWei: bigint | null;
  estimatedFeeWei: bigint | null;
  /** amount + estimated fee — what the sender must be able to cover. */
  requiredWei: bigint | null;
  ok: boolean;
  errors: string[];
}

/**
 * Runs all read-only pre-broadcast checks. Never throws; failures are
 * collected so the caller can abort with exact reasons.
 */
export async function runPreflight(
  client: RpcLike,
  sender: `0x${string}`,
  recipient: `0x${string}`,
  amountWei: bigint,
): Promise<PreflightResult> {
  const errors: string[] = [];
  let chainId: number | null = null;
  let blockNumber: bigint | null = null;
  let senderBalanceWei: bigint | null = null;
  let estimatedGas: bigint | null = null;
  let gasPriceWei: bigint | null = null;

  try {
    chainId = await client.getChainId();
    if (chainId !== 688689) {
      errors.push(
        `RPC chain ID is ${chainId}; this script is hard-locked to Pharos Atlantic ` +
          'Testnet (688689). Broadcast refused.',
      );
    }
  } catch (err) {
    errors.push(`Could not read chain ID from RPC: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    blockNumber = await client.getBlockNumber();
  } catch {
    // Non-fatal context: leave blockNumber null.
  }

  try {
    estimatedGas = await client.estimateGas({
      account: sender,
      to: recipient,
      value: amountWei,
      data: '0x',
    });
  } catch (err) {
    errors.push(
      `Gas estimation failed for the transfer: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    gasPriceWei = await client.getGasPrice();
  } catch (err) {
    errors.push(`Could not read gas price: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    senderBalanceWei = await client.getBalance({ address: sender });
  } catch (err) {
    errors.push(`Could not read sender balance: ${err instanceof Error ? err.message : String(err)}`);
  }

  const estimatedFeeWei =
    estimatedGas !== null && gasPriceWei !== null ? estimatedGas * gasPriceWei : null;
  const requiredWei = estimatedFeeWei !== null ? amountWei + estimatedFeeWei : null;

  if (senderBalanceWei !== null && requiredWei !== null && senderBalanceWei < requiredWei) {
    errors.push(
      `Insufficient balance: sender holds ${senderBalanceWei} wei but amount + estimated fee ` +
        `requires ${requiredWei} wei (missing ${requiredWei - senderBalanceWei} wei).`,
    );
  }

  return {
    chainId,
    blockNumber,
    senderBalanceWei,
    estimatedGas,
    gasPriceWei,
    estimatedFeeWei,
    requiredWei,
    ok: errors.length === 0,
    errors,
  };
}
