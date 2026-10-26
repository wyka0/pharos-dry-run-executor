/**
 * Live testnet transaction — local signing and raw submission.
 *
 * The Atlantic testnet RPC does not support `eth_sendTransaction` (it
 * rejects it with "invalid method"). Transactions are therefore signed
 * LOCALLY with the account's private key (viem wallet client/account) and
 * the serialized bytes are submitted through `eth_sendRawTransaction`.
 *
 * SAFETY:
 * - Signing performs NO RPC calls: nonce, gas, and gasPrice are supplied.
 * - The private key never leaves the account object; it is never logged.
 * - The serialized transaction is returned only for test assertions and is
 *   never logged or written to evidence (the script passes it to the
 *   evidence secret-safety check as forbidden material).
 * - No automatic retries: on ambiguous submission failures the caller must
 *   check for pending transactions before ever considering a re-send.
 */

import { createWalletClient, http } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import { pharosAtlantic } from '../rpc/client.js';

/** Minimal structural type for a viem wallet client's local signing. */
export interface TransactionSigner {
  signTransaction(transaction: {
    to: `0x${string}`;
    value: bigint;
    nonce: number;
    gas: bigint;
    gasPrice: bigint;
    chainId: number;
  }): Promise<`0x${string}`>;
}

/** Minimal structural type for eth_sendRawTransaction submission. */
export interface RawSubmitter {
  sendRawTransaction(args: {
    serializedTransaction: `0x${string}`;
  }): Promise<`0x${string}`>;
}

export interface BroadcastTx {
  to: `0x${string}`;
  value: bigint;
  nonce: number;
  gas: bigint;
  gasPrice: bigint;
}

export interface SignedBroadcastResult {
  transactionHash: `0x${string}`;
  /** Serialized signed transaction — internal/test use only, never persisted. */
  serialized: `0x${string}`;
}

/**
 * Signs the transaction locally (legacy type-0 tx: deterministic cost =
 * gas × gasPrice, matching the displayed estimate) and submits the
 * serialized bytes via eth_sendRawTransaction. The wallet client is
 * injectable so tests can record every RPC method called.
 */
export async function signAndBroadcast(
  account: PrivateKeyAccount,
  rpcUrl: string,
  tx: BroadcastTx,
  rawSubmitter: RawSubmitter,
  signer?: TransactionSigner,
): Promise<SignedBroadcastResult> {
  const walletClient: TransactionSigner =
    signer ??
    (createWalletClient({
      chain: pharosAtlantic,
      transport: http(rpcUrl, { timeout: 15_000, retryCount: 0 }),
      account,
    }) as unknown as TransactionSigner);

  // Local signing: no eth_sendTransaction, no eth_sign, no RPC round-trip.
  const serialized = await walletClient.signTransaction({
    to: tx.to,
    value: tx.value,
    nonce: tx.nonce,
    gas: tx.gas,
    gasPrice: tx.gasPrice,
    chainId: pharosAtlantic.id, // hard-locked to 688689
  });

  // Raw submission: the only broadcast method this RPC supports.
  const transactionHash = await rawSubmitter.sendRawTransaction({
    serializedTransaction: serialized,
  });

  return { transactionHash, serialized };
}

export interface PendingAssessment {
  hasPending: boolean;
  detail: string;
}

/**
 * Compares the sender's pending vs latest nonce to detect unmined
 * transactions from previous attempts. Used to avoid accidental duplicate
 * sends — never re-send while a pending transaction exists.
 */
export function assessPendingTransactions(
  latestCount: number | null,
  pendingCount: number | null,
): PendingAssessment {
  if (latestCount === null || pendingCount === null) {
    return {
      hasPending: false,
      detail: 'Pending-transaction check unavailable (nonce read failed); cannot rule out a pending transaction.',
    };
  }
  if (pendingCount > latestCount) {
    return {
      hasPending: true,
      detail:
        `Sender has ${pendingCount - latestCount} unmined (pending) transaction(s). ` +
        'A previous attempt may still be mined — check the explorer before re-running; do NOT send again.',
    };
  }
  return {
    hasPending: false,
    detail: 'No pending transactions detected for the sender.',
  };
}
