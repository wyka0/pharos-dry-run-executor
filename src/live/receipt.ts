/**
 * Live testnet transaction — receipt verification (pure functions).
 *
 * Summarizes an actual RPC transaction + receipt pair. All values come
 * from the RPC; nothing is fabricated. Failure statuses are preserved and
 * reported honestly.
 */

export interface ReceiptLike {
  status: string | null; // 'success' | 'reverted' (viem normalization)
  transactionHash: `0x${string}` | null;
  blockNumber: bigint | null;
  gasUsed: bigint | null;
  effectiveGasPrice: bigint | null;
}

export interface TransactionLike {
  from: `0x${string}` | null;
  to: `0x${string}` | null;
  value: bigint | null;
  /** Chain ID embedded in the signed transaction (from eth_getTransactionByHash). */
  chainId: number | null;
}

export interface ReceiptSummary {
  /** True only when receipt.status === 'success'. */
  ok: boolean;
  receiptStatus: string;
  transactionHash: `0x${string}` | null;
  blockNumber: bigint | null;
  gasUsed: bigint | null;
  effectiveGasPriceWei: bigint | null;
  /** gasUsed × effectiveGasPrice, in wei (exact BigInt). */
  actualFeeWei: bigint | null;
  from: `0x${string}` | null;
  to: `0x${string}` | null;
  valueWei: bigint | null;
  /** True when the signed transaction itself carries chainId 688689. */
  txChainIdIsTestnet: boolean | null;
  /** current block − receipt block + 1, when both are known. */
  confirmations: bigint | null;
}

const REQUIRED_CHAIN_ID = 688689;

/** Builds a receipt summary from actual RPC data (pure, no I/O). */
export function summarizeReceipt(
  receipt: ReceiptLike,
  tx: TransactionLike,
  currentBlockNumber: bigint | null,
): ReceiptSummary {
  const ok = receipt.status === 'success';
  const confirmations =
    receipt.blockNumber !== null &&
    currentBlockNumber !== null &&
    currentBlockNumber >= receipt.blockNumber
      ? currentBlockNumber - receipt.blockNumber + 1n
      : null;
  const actualFeeWei =
    receipt.gasUsed !== null && receipt.effectiveGasPrice !== null
      ? receipt.gasUsed * receipt.effectiveGasPrice
      : null;
  return {
    ok,
    receiptStatus: receipt.status ?? 'unknown',
    transactionHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
    effectiveGasPriceWei: receipt.effectiveGasPrice,
    actualFeeWei,
    from: tx.from,
    to: tx.to,
    valueWei: tx.value,
    txChainIdIsTestnet: tx.chainId === null ? null : tx.chainId === REQUIRED_CHAIN_ID,
    confirmations,
  };
}
