/**
 * Unit tests for the live testnet transaction helpers: configuration
 * validation, the BROADCAST confirmation gate, preflight checks, receipt
 * summarization, and evidence building.
 *
 * These tests NEVER create a wallet client and NEVER broadcast anything —
 * they exercise pure functions and fake RPC clients only.
 */

import { describe, expect, it } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
  loadLiveTxConfig,
  DEFAULT_AMOUNT_PHRS,
  DEFAULT_LIVE_RPC_URL,
  REQUIRED_CHAIN_ID,
} from '../src/live/config.js';
import {
  CONFIRMATION_PHRASE,
  evaluateConfirmation,
  readConfirmation,
} from '../src/live/confirm.js';
import { runPreflight } from '../src/live/preflight.js';
import { summarizeReceipt } from '../src/live/receipt.js';
import {
  assertEvidenceHasNoSecrets,
  buildEvidenceJson,
  buildEvidenceMarkdown,
  type EvidenceData,
} from '../src/live/evidence.js';
import { createFakeRpc } from './helpers.js';

const TEST_KEY = generatePrivateKey();
const TEST_ACCOUNT = privateKeyToAccount(TEST_KEY);
const RECIPIENT = '0x000000000000000000000000000000000000dEaD' as const;

function envWith(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    PHAROS_TESTNET_PRIVATE_KEY: TEST_KEY,
    PHAROS_TESTNET_RECIPIENT: RECIPIENT,
    ...overrides,
  };
}

describe('live transaction configuration validation', () => {
  it('accepts a valid configuration and derives the sender from the key', () => {
    const result = loadLiveTxConfig(envWith());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.sender).toBe(TEST_ACCOUNT.address);
      expect(result.config.recipient).toBe(RECIPIENT);
      expect(result.config.amountWei).toBe(1_000_000_000_000_000n); // default 0.001 PHRS
      expect(result.config.amountPhrs).toBe('0.001');
      expect(result.config.rpcUrl).toBe(DEFAULT_LIVE_RPC_URL);
      expect(result.config.chainId).toBe(REQUIRED_CHAIN_ID);
    }
  });

  it('rejects a missing private key', () => {
    const result = loadLiveTxConfig({
      PHAROS_TESTNET_PRIVATE_KEY: undefined,
      PHAROS_TESTNET_RECIPIENT: RECIPIENT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toContain('PHAROS_TESTNET_PRIVATE_KEY is not set');
    }
  });

  it('rejects a malformed private key and never echoes its value', () => {
    const badKey = '0x1234';
    const result = loadLiveTxConfig({
      PHAROS_TESTNET_PRIVATE_KEY: badKey,
      PHAROS_TESTNET_RECIPIENT: RECIPIENT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const joined = result.errors.join(' ');
      expect(joined).toContain('malformed');
      expect(joined).not.toContain(badKey);
    }
  });

  it('rejects a private key with the wrong length (63 hex chars)', () => {
    const shortKey = '0x' + 'a'.repeat(63);
    const result = loadLiveTxConfig({
      PHAROS_TESTNET_PRIVATE_KEY: shortKey,
      PHAROS_TESTNET_RECIPIENT: RECIPIENT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toContain('malformed');
  });

  it('rejects a missing recipient (nothing is assumed)', () => {
    const result = loadLiveTxConfig({ PHAROS_TESTNET_PRIVATE_KEY: TEST_KEY });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toContain('PHAROS_TESTNET_RECIPIENT is not set');
    }
  });

  it('rejects an invalid recipient address', () => {
    const result = loadLiveTxConfig(envWith({ PHAROS_TESTNET_RECIPIENT: '0xdead' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toContain('malformed');
  });

  it('rejects the zero address as recipient', () => {
    const result = loadLiveTxConfig(
      envWith({ PHAROS_TESTNET_RECIPIENT: '0x0000000000000000000000000000000000000000' }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toContain('zero address');
  });

  it('accepts a custom small amount and converts it exactly to wei', () => {
    const result = loadLiveTxConfig(envWith({ PHAROS_TESTNET_AMOUNT: '0.000000000000000001' }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config.amountWei).toBe(1n);
  });

  it('rejects a zero amount', () => {
    const result = loadLiveTxConfig(envWith({ PHAROS_TESTNET_AMOUNT: '0' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toContain('greater than zero');
  });

  it('rejects a non-numeric amount', () => {
    const result = loadLiveTxConfig(envWith({ PHAROS_TESTNET_AMOUNT: 'much' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toContain('is invalid');
  });

  it('rejects amounts above the 1 PHRS safety cap', () => {
    const result = loadLiveTxConfig(envWith({ PHAROS_TESTNET_AMOUNT: '1.5' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toContain('safety cap');
  });

  it('rejects amounts with more than 18 decimals', () => {
    const result = loadLiveTxConfig(envWith({ PHAROS_TESTNET_AMOUNT: '0.0000000000000000001' }));
    expect(result.ok).toBe(false);
  });

  it('hard-locks the chain to 688689 (mainnet or any other chain is refused)', () => {
    for (const chainId of ['1', '1672', '688688']) {
      const result = loadLiveTxConfig(envWith({ PHAROS_TESTNET_CHAIN_ID: chainId }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.join(' ')).toContain('hard-locked');
    }
  });

  it('rejects a non-integer chain ID and a non-HTTP RPC URL', () => {
    expect(loadLiveTxConfig(envWith({ PHAROS_TESTNET_CHAIN_ID: 'abc' })).ok).toBe(false);
    expect(loadLiveTxConfig(envWith({ PHAROS_TESTNET_RPC_URL: 'ftp://example.com' })).ok).toBe(false);
  });

  it('uses the documented default amount', () => {
    expect(DEFAULT_AMOUNT_PHRS).toBe('0.001');
  });
});

describe('BROADCAST confirmation gate', () => {
  it('accepts the exact phrase', () => {
    expect(evaluateConfirmation('BROADCAST')).toEqual({ decision: 'CONFIRMED' });
    expect(evaluateConfirmation('  BROADCAST  ')).toEqual({ decision: 'CONFIRMED' });
    expect(CONFIRMATION_PHRASE).toBe('BROADCAST');
  });

  it('refuses anything else: wrong case, other words, empty, EOF', () => {
    for (const input of ['broadcast', 'Broadcast', 'BROADCA5T', 'yes', 'y', '', '   ', null, undefined]) {
      const result = evaluateConfirmation(input);
      expect(result.decision).toBe('REFUSED');
      if (result.decision === 'REFUSED') expect(result.reason).toContain('Nothing was sent');
    }
  });

  it('readConfirmation evaluates the injected reader output', async () => {
    const confirmed = await readConfirmation(async () => 'BROADCAST\n');
    expect(confirmed.decision).toBe('CONFIRMED');

    const refused = await readConfirmation(async () => 'nope');
    expect(refused.decision).toBe('REFUSED');
  });

  it('refuses when the reader throws (input error)', async () => {
    const result = await readConfirmation(async () => {
      throw new Error('stdin closed');
    });
    expect(result.decision).toBe('REFUSED');
    if (result.decision === 'REFUSED') expect(result.reason).toContain('Nothing was sent');
  });
});

describe('pre-broadcast preflight (fake RPC, read-only)', () => {
  it('passes when chain, gas, price, and balance are sufficient', async () => {
    const client = createFakeRpc({
      chainId: 688689,
      estimateGas: 21_000n,
      gasPrice: 10_000_000_000n,
      balances: { [TEST_ACCOUNT.address.toLowerCase()]: 10n ** 18n },
    });
    const pre = await runPreflight(client, TEST_ACCOUNT.address, RECIPIENT, 1_000_000_000_000_000n);
    expect(pre.ok).toBe(true);
    expect(pre.estimatedFeeWei).toBe(210_000_000_000_000n);
    expect(pre.requiredWei).toBe(1_210_000_000_000_000n);
  });

  it('refuses when the RPC chain ID is not 688689', async () => {
    const client = createFakeRpc({ chainId: 1 });
    const pre = await runPreflight(client, TEST_ACCOUNT.address, RECIPIENT, 1n);
    expect(pre.ok).toBe(false);
    expect(pre.errors.join(' ')).toContain('hard-locked');
  });

  it('refuses when the sender cannot cover amount + fee', async () => {
    const client = createFakeRpc({
      chainId: 688689,
      estimateGas: 21_000n,
      gasPrice: 10_000_000_000n,
      balances: { [TEST_ACCOUNT.address.toLowerCase()]: 1n },
    });
    const pre = await runPreflight(client, TEST_ACCOUNT.address, RECIPIENT, 1_000_000_000_000_000n);
    expect(pre.ok).toBe(false);
    expect(pre.errors.join(' ')).toContain('Insufficient balance');
  });

  it('refuses when gas estimation fails', async () => {
    const client = createFakeRpc({
      chainId: 688689,
      estimateGas: new Error('intrinsic gas too low'),
    });
    const pre = await runPreflight(client, TEST_ACCOUNT.address, RECIPIENT, 1n);
    expect(pre.ok).toBe(false);
    expect(pre.errors.join(' ')).toContain('Gas estimation failed');
  });
});

describe('receipt verification (pure)', () => {
  const receipt = {
    status: 'success',
    transactionHash: '0xabc' as `0x${string}`,
    blockNumber: 100n,
    gasUsed: 21_000n,
    effectiveGasPrice: 10_000_000_000n,
  };
  const tx = { from: TEST_ACCOUNT.address, to: RECIPIENT, value: 1_000_000_000_000_000n, chainId: 688689 };

  it('verifies a successful receipt with exact fee math', () => {
    const summary = summarizeReceipt(receipt, tx, 102n);
    expect(summary.ok).toBe(true);
    expect(summary.actualFeeWei).toBe(210_000_000_000_000n);
    expect(summary.confirmations).toBe(3n); // 102 - 100 + 1
    expect(summary.txChainIdIsTestnet).toBe(true);
  });

  it('reports a failed receipt honestly (no success claim)', () => {
    const summary = summarizeReceipt({ ...receipt, status: 'reverted' }, tx, 102n);
    expect(summary.ok).toBe(false);
    expect(summary.receiptStatus).toBe('reverted');
  });

  it('returns null confirmations when the current block is unknown', () => {
    const summary = summarizeReceipt(receipt, tx, null);
    expect(summary.confirmations).toBeNull();
  });

  it('flags a transaction signed for another chain', () => {
    const summary = summarizeReceipt(receipt, { ...tx, chainId: 1 }, 102n);
    expect(summary.txChainIdIsTestnet).toBe(false);
  });
});

describe('evidence builders', () => {
  const base: EvidenceData = {
    timestampIso: '2026-10-26T12:00:00.000Z',
    broadcastAtIso: '2026-10-26T11:59:59.000Z',
    networkName: 'Pharos Atlantic Testnet',
    chainId: 688689,
    rpcUrl: DEFAULT_LIVE_RPC_URL,
    sender: TEST_ACCOUNT.address,
    recipient: RECIPIENT,
    amountWei: '1000000000000000',
    amountPhrs: '0.001',
    transactionHash: '0xabc123',
    blockNumber: '31897000',
    receiptStatus: 'success',
    gasUsed: '21000',
    effectiveGasPriceWei: '10000000000',
    actualFeeWei: '210000000000000',
    actualFeePhrs: '0.00021',
    explorerUrl: null,
    explorerVerified: false,
    confirmations: '3',
    preBroadcastSimulation: { status: 'SUCCESS', guardDecision: 'GO' },
  };

  it('includes the required evidence fields in JSON and Markdown', () => {
    const json = buildEvidenceJson(base);
    const md = buildEvidenceMarkdown(base);
    for (const text of [json, md]) {
      expect(text).toContain('688689');
      expect(text).toContain('Pharos Atlantic Testnet');
      expect(text).toContain('success');
      expect(text).toContain('210000000000000');
      expect(text).toContain('1000000000000000');
    }
    expect(json).toContain('"receiptStatus": "success"');
  });

  it('includes the explorer URL only when verified', () => {
    const without = buildEvidenceJson(base);
    expect(without).toContain('"explorerUrl": null');

    const withExplorer = buildEvidenceJson({
      ...base,
      explorerUrl: 'https://atlantic.pharosscan.xyz/tx/0xabc123',
      explorerVerified: true,
    });
    expect(withExplorer).toContain('atlantic.pharosscan.xyz/tx/0xabc123');
  });

  it('never contains key-shaped hex or key variable names', () => {
    const text = buildEvidenceJson(base) + buildEvidenceMarkdown(base);
    expect(text).not.toMatch(/0x[0-9a-fA-F]{64}/);
    expect(text).not.toContain('PHAROS_TESTNET_PRIVATE_KEY');
    expect(text).not.toContain(TEST_KEY);
  });

  it('assertEvidenceHasNoSecrets rejects key-shaped content', () => {
    expect(() => assertEvidenceHasNoSecrets('key: 0x' + 'ab'.repeat(32))).toThrow();
    expect(() => assertEvidenceHasNoSecrets('PHAROS_TESTNET_PRIVATE_KEY=0xabc')).toThrow();
    expect(() => assertEvidenceHasNoSecrets('safe content only')).not.toThrow();
  });
});
