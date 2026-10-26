/**
 * Read-only RPC client for the Pharos Atlantic Testnet.
 *
 * Only these JSON-RPC methods are ever used:
 *   eth_chainId, eth_blockNumber, eth_getBalance, eth_gasPrice,
 *   eth_call, eth_estimateGas
 *
 * SAFETY: no eth_sendTransaction, no eth_sendRawTransaction, no signing,
 * no broadcasting — by construction. This module exposes nothing else.
 */

import { createPublicClient, defineChain, http, type Chain, type PublicClient } from 'viem';
import type { ExecutorConfig } from '../config.js';
import { RpcUnavailableError, describeError } from './errors.js';

export const PHAROS_ATLANTIC_CHAIN_ID = 688689;

/** Pharos Atlantic Testnet chain definition for viem. */
export const pharosAtlantic: Chain = defineChain({
  id: PHAROS_ATLANTIC_CHAIN_ID,
  name: 'Pharos Atlantic Testnet',
  nativeCurrency: { name: 'Pharos', symbol: 'PHRS', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://atlantic.dplabs-internal.com'] },
  },
});

/**
 * Structural subset of viem's PublicClient used by this project. Keeping it
 * structural lets unit tests inject plain fake clients without a network.
 */
export interface RpcLike {
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
  getBalance(args: { address: `0x${string}` }): Promise<bigint>;
  getGasPrice(): Promise<bigint>;
  call(args: {
    account?: `0x${string}`;
    to: `0x${string}`;
    value?: bigint;
    data?: `0x${string}`;
    gas?: bigint;
  }): Promise<{ data?: `0x${string}` }>;
  estimateGas(args: {
    account?: `0x${string}`;
    to: `0x${string}`;
    value?: bigint;
    data?: `0x${string}`;
    gas?: bigint;
  }): Promise<bigint>;
}

/** Creates a read-only viem client against the configured RPC endpoint. */
export function createRpcClient(config: ExecutorConfig): PublicClient {
  const transport = http(config.rpcUrl, {
    timeout: 15_000,
    retryCount: 0,
  });
  return createPublicClient({
    // The configured chain definition is only metadata; the RPC-reported
    // chain ID is verified separately in verifyNetwork().
    chain: config.chainId === PHAROS_ATLANTIC_CHAIN_ID ? pharosAtlantic : undefined,
    transport,
  }) as unknown as RpcLike as PublicClient;
}

export interface NetworkVerification {
  chainId: number | null;
  blockNumber: bigint | null;
  verified: boolean;
  error: string | null;
}

/**
 * Verifies the RPC endpoint is reachable and reports the expected chain ID.
 * Returns a structured result instead of throwing, so callers can fail
 * closed without losing the reason.
 */
export async function verifyNetwork(
  client: RpcLike,
  config: ExecutorConfig,
): Promise<NetworkVerification> {
  try {
    const chainId = await client.getChainId();
    if (chainId !== config.chainId) {
      return {
        chainId,
        blockNumber: null,
        verified: false,
        error:
          `RPC chain ID mismatch: endpoint reports ${chainId}, ` +
          `configuration expects ${config.chainId} (${config.chainName}).`,
      };
    }
    let blockNumber: bigint | null = null;
    try {
      blockNumber = await client.getBlockNumber();
    } catch (err) {
      // Chain ID matched; block read is best-effort extra evidence.
      blockNumber = null;
      void err;
    }
    return { chainId, blockNumber, verified: true, error: null };
  } catch (err) {
    return {
      chainId: null,
      blockNumber: null,
      verified: false,
      error: `RPC endpoint unreachable (${describeError(err)}). ` +
        'No simulation was performed — refusing to fabricate results.',
    };
  }
}

/** Guard used internally to prove a client is usable before simulating. */
export function assertRpcAvailable(client: RpcLike, config: ExecutorConfig): void {
  if (client === null || client === undefined) {
    throw new RpcUnavailableError(`No RPC client configured for chain ${config.chainId}.`);
  }
}
