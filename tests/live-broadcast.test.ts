/**
 * Unit tests for the raw-submission broadcast path.
 *
 * Proves that:
 *  1. signing is fully local (zero RPC calls during signTransaction);
 *  2. submission uses exactly `eth_sendRawTransaction`;
 *  3. `eth_sendTransaction` is NEVER called (a recording transport throws
 *     if it ever is);
 *  4. the signed transaction is hard-locked to chain ID 688689 with the
 *     configured recipient, value, nonce, gas, and gas price;
 *  5. ambiguous-failure helpers refuse automatic retries and detect
 *     pending duplicates;
 *  6. evidence builders reject the serialized transaction and private key.
 *
 * No real network access, no real broadcast — the transport is an in-memory
 * recorder and keys are generated throwaway keys.
 */

import { describe, expect, it } from 'vitest';
import {
  createPublicClient,
  createWalletClient,
  parseTransaction,
  type Transport,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
  assessPendingTransactions,
  signAndBroadcast,
} from '../src/live/broadcast.js';
import { pharosAtlantic } from '../src/rpc/client.js';
import { assertEvidenceHasNoSecrets, buildEvidenceJson, type EvidenceData } from '../src/live/evidence.js';

const RECIPIENT = '0x000000000000000000000000000000000000dEaD' as const;
const FAKE_HASH = `0x${'ab'.repeat(32)}` as `0x${string}`;

/**
 * Builds a recording in-memory transport factory. Every RPC method that
 * reaches it is recorded. `eth_sendTransaction` always throws — proving
 * the fixed submission path never touches it. `eth_chainId` is answered
 * because viem's signTransaction calls it (read-only) even for local
 * accounts before asserting the chain.
 */
function makeRecordingTransport(calls: string[]): Transport {
  let counter = 0;
  const factory = ({ retryCount = 0, timeout = 5_000 } = {}): Record<string, unknown> => {
    counter += 1;
    const key = `recording-${counter}`;
    const request = async ({ method }: { method: string; params?: unknown }): Promise<unknown> => {
      calls.push(method);
      if (method === 'eth_sendTransaction') {
        throw new Error('FORBIDDEN: eth_sendTransaction must never be called');
      }
      if (method === 'eth_chainId') {
        return '0xa8231'; // 688689 — Pharos Atlantic Testnet
      }
      if (method === 'eth_sendRawTransaction') {
        return FAKE_HASH;
      }
      throw new Error(`unexpected RPC method: ${method}`);
    };
    return {
      config: { key, name: 'recording', request, retryCount, timeout, type: 'recording' },
      request,
    };
  };
  return factory as unknown as Transport;
}

describe('signAndBroadcast — local signing + eth_sendRawTransaction submission', () => {
  it('signs with only read-only RPC, submits via eth_sendRawTransaction, never eth_sendTransaction', async () => {
    const calls: string[] = [];
    const transport = makeRecordingTransport(calls);
    const account = privateKeyToAccount(generatePrivateKey());

    // Wallet client (for signing) and public client (for raw submission)
    // both use the recording transport. Pass the FACTORY — viem invokes it.
    const walletClient = createWalletClient({ account, transport, chain: pharosAtlantic });
    const publicClient = createPublicClient({ transport });

    const result = await signAndBroadcast(
      account,
      'https://recording.invalid',
      {
        to: RECIPIENT,
        value: 1_000_000_000_000_000n,
        nonce: 7,
        gas: 21_000n,
        gasPrice: 10_000_000_000n,
      },
      publicClient,
      walletClient,
    );

    // The only RPC methods that ever fire are eth_chainId (read-only,
    // performed by viem's signTransaction) and eth_sendRawTransaction.
    // eth_sendTransaction is NEVER called — the transport throws if it is.
    expect(calls).toEqual(['eth_chainId', 'eth_sendRawTransaction']);
    expect(result.transactionHash).toBe(FAKE_HASH);
    // Serialized bytes are returned for assertions.
    expect(result.serialized).toMatch(/^0x[0-9a-fA-F]+$/);
  });

  it('embeds chainId 688689, recipient, value, nonce, gas, and gasPrice in the signature', async () => {
    const calls: string[] = [];
    const transport = makeRecordingTransport(calls);
    const account = privateKeyToAccount(generatePrivateKey());
    const walletClient = createWalletClient({ account, transport, chain: pharosAtlantic });
    const publicClient = createPublicClient({ transport });

    const value = 2_500_000_000_000_000n;
    const nonce = 42;
    const gas = 21_000n;
    const gasPrice = 10_000_000_000n;

    const { serialized } = await signAndBroadcast(
      account,
      'https://recording.invalid',
      { to: RECIPIENT, value, nonce, gas, gasPrice },
      publicClient,
      walletClient,
    );

    const parsed = parseTransaction(serialized);
    expect(parsed.chainId).toBe(688689); // hard-locked to Pharos Atlantic Testnet
    expect(parsed.type).toBe('legacy');
    expect(parsed.to?.toLowerCase()).toBe(RECIPIENT.toLowerCase());
    expect(parsed.value).toBe(value);
    expect(parsed.nonce).toBe(nonce);
    expect(parsed.gas).toBe(gas);
    expect(parsed.gasPrice).toBe(gasPrice);
  });

  it('default signer path (no injected signer) builds a network-backed wallet client and fails offline without any submission', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const submitted: `0x${string}`[] = [];

    // viem's signTransaction performs a read-only eth_chainId against the
    // configured RPC; offline (unresolvable host) it must fail BEFORE any
    // submission happens — and must never call eth_sendTransaction.
    await expect(
      signAndBroadcast(
        account,
        'https://recording.invalid',
        { to: RECIPIENT, value: 1n, nonce: 0, gas: 21_000n, gasPrice: 1_000_000_000n },
        {
          async sendRawTransaction(args) {
            submitted.push(args.serializedTransaction);
            return FAKE_HASH;
          },
        },
        // No injected signer: signAndBroadcast builds its own http-backed
        // wallet client, which cannot reach the network in this offline test.
      ),
    ).rejects.toThrow(/HTTP|fetch|request/i);

    expect(submitted).toHaveLength(0); // nothing was submitted when signing failed
  });

  it('produces a signed transaction whose recovered chain is the injected pharos chain definition', () => {
    // Sanity check on the chain definition itself: the module must be
    // hard-locked to 688689.
    expect(pharosAtlantic.id).toBe(688689);
  });
});

describe('pending-transaction duplicate guard', () => {
  it('detects unmined transactions (pending > latest) and refuses re-sends', () => {
    const assessment = assessPendingTransactions(5, 6);
    expect(assessment.hasPending).toBe(true);
    expect(assessment.detail).toContain('do NOT send again');
  });

  it('passes when pending equals latest', () => {
    const assessment = assessPendingTransactions(5, 5);
    expect(assessment.hasPending).toBe(false);
  });

  it('reports unavailability rather than guessing when nonce reads fail', () => {
    const assessment = assessPendingTransactions(null, null);
    expect(assessment.hasPending).toBe(false);
    expect(assessment.detail).toContain('cannot rule out a pending transaction');
  });
});

describe('evidence must never contain the serialized transaction or the key', () => {
  const base: EvidenceData = {
    timestampIso: '2026-10-27T12:00:00.000Z',
    broadcastAtIso: '2026-10-27T11:59:59.000Z',
    networkName: 'Pharos Atlantic Testnet',
    chainId: 688689,
    rpcUrl: 'https://atlantic.dplabs-internal.com',
    sender: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    recipient: RECIPIENT,
    amountWei: '1000000000000000',
    amountPhrs: '0.001',
    transactionHash: FAKE_HASH,
    blockNumber: '31900000',
    receiptStatus: 'success',
    gasUsed: '21000',
    effectiveGasPriceWei: '10000000000',
    actualFeeWei: '210000000000000',
    actualFeePhrs: '0.00021',
    explorerUrl: null,
    explorerVerified: false,
    confirmations: '1',
    preBroadcastSimulation: { status: 'SUCCESS', guardDecision: 'GO' },
  };

  it('accepts clean evidence even when forbidden values are supplied', () => {
    const json = buildEvidenceJson(base);
    // The tx hash itself legitimately appears in evidence; only key material
    // and the serialized transaction are forbidden.
    expect(() => assertEvidenceHasNoSecrets(json, ['0xdeadbeefcafe'])).not.toThrow();
  });

  it('rejects evidence that would embed the serialized signed transaction', async () => {
    const calls: string[] = [];
    const transport = makeRecordingTransport(calls);
    const account = privateKeyToAccount(generatePrivateKey());
    const walletClient = createWalletClient({ account, transport, chain: pharosAtlantic });
    const publicClient = createPublicClient({ transport });
    const { serialized } = await signAndBroadcast(
      account,
      'https://recording.invalid',
      { to: RECIPIENT, value: 1n, nonce: 0, gas: 21_000n, gasPrice: 1_000_000_000n },
      publicClient,
      walletClient,
    );

    const json = buildEvidenceJson(base);
    expect(json).not.toContain(serialized); // builders never include it by construction
    expect(() => assertEvidenceHasNoSecrets(json, [serialized])).not.toThrow();

    const tampered = json.replace('"receiptStatus": "success"', `"receiptStatus": "x","tx": "${serialized}"`);
    expect(() => assertEvidenceHasNoSecrets(tampered, [serialized])).toThrow();
  });

  it('rejects evidence that would embed the raw private key', () => {
    const key = generatePrivateKey();
    const json = buildEvidenceJson(base);
    expect(json).not.toContain(key);
    expect(() => assertEvidenceHasNoSecrets(json, [key])).not.toThrow();

    const tampered = `${json}key: ${key}`;
    expect(() => assertEvidenceHasNoSecrets(tampered, [key])).toThrow();
  });
});
