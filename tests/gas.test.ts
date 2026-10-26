/**
 * Unit tests: gas estimation, gas cost calculation, and BigInt/exact-string
 * arithmetic. No network access, no floating-point math anywhere.
 */

import { describe, expect, it } from 'vitest';
import {
  calculateCost,
  calculateGasCostWei,
  formatGwei,
  formatPhrs,
  weiToDecimalUnits,
} from '../src/simulation/calculate-cost.js';
import { estimateGasAndPrice } from '../src/simulation/estimate-gas.js';
import { validateTransaction } from '../src/validation/transaction.js';
import { createFakeRpc } from './helpers.js';

const VALID_TX = {
  from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  to: '0x000000000000000000000000000000000000dEaD',
  value: '1000000000000000',
  data: '0x',
};

async function validatedInput() {
  const result = validateTransaction(VALID_TX);
  if (!result.ok) throw new Error('validation should pass');
  return result.value;
}

describe('gas estimation via fake RPC', () => {
  it('estimates gas and gas price, and computes the cost', async () => {
    const client = createFakeRpc({ estimateGas: 21_000n, gasPrice: 10_000_000_000n });
    const outcome = await estimateGasAndPrice(client, await validatedInput());
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.gasLimit).toBe(21_000n);
      expect(outcome.gasPriceWei).toBe(10_000_000_000n);
      expect(outcome.gasCostWei).toBe(210_000_000_000_000n);
      expect(outcome.gasCostPhrs).toBe('0.000210000000000000');
      expect(outcome.feeAssumptions.method).toBe('eth_estimateGas + eth_gasPrice');
    }
  });

  it('uses a user-supplied gas limit without calling eth_estimateGas', async () => {
    const client = createFakeRpc({ estimateGas: 99_999n, gasPrice: 10_000_000_000n });
    const input = { ...(await validatedInput()), gasLimit: 50_000n };
    const outcome = await estimateGasAndPrice(client, input);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.gasLimit).toBe(50_000n);
    expect(client.calls).not.toContain('estimateGas');
  });

  it('reports GAS_ESTIMATION (not RPC) when the tx cannot execute', async () => {
    const revert = Object.assign(new Error('execution reverted: nope'), { code: 3 });
    const client = createFakeRpc({ estimateGas: revert, gasPrice: 10_000_000_000n });
    const outcome = await estimateGasAndPrice(client, await validatedInput());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.failureKind).toBe('GAS_ESTIMATION');
  });

  it('reports RPC when the node is unreachable during gas estimation', async () => {
    const rpcError = Object.assign(new Error('fetch failed'), { name: 'HttpRequestError' });
    const client = createFakeRpc({ estimateGas: rpcError });
    const outcome = await estimateGasAndPrice(client, await validatedInput());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.failureKind).toBe('RPC');
  });

  it('reports RPC when eth_gasPrice fails', async () => {
    const rpcError = Object.assign(new Error('socket hang up'), { name: 'HttpRequestError' });
    const client = createFakeRpc({ estimateGas: 21_000n, gasPriceError: rpcError });
    const outcome = await estimateGasAndPrice(client, await validatedInput());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.failureKind).toBe('RPC');
  });
});

describe('gas cost calculation (BigInt only)', () => {
  it('multiplies gas limit by gas price exactly', () => {
    expect(calculateGasCostWei(21_000n, 10_000_000_000n)).toBe(210_000_000_000_000n);
    expect(calculateGasCostWei(0n, 10_000_000_000n)).toBe(0n);
    expect(calculateGasCostWei(63_575n, 1_000_000_000n)).toBe(63_575_000_000_000n);
  });

  it('stays exact far beyond Number.MAX_SAFE_INTEGER', () => {
    // 2**100 wei per gas — impossible with JS numbers, exact with BigInt.
    const gasPrice = 2n ** 100n;
    const expected = 21_000n * gasPrice;
    expect(calculateGasCostWei(21_000n, gasPrice)).toBe(expected);
    expect(expected > Number.MAX_SAFE_INTEGER).toBe(true);
  });

  it('rejects negative inputs', () => {
    expect(() => calculateGasCostWei(-1n, 10n)).toThrow();
    expect(() => calculateGasCostWei(1n, -10n)).toThrow();
  });

  it('builds a full cost object with fee assumptions', () => {
    const cost = calculateCost(21_000n, 10_000_000_000n, {
      method: 'eth_gasPrice',
      note: 'test note',
    });
    expect(cost.gasCostWei).toBe(210_000_000_000_000n);
    expect(cost.gasCostPhrs).toBe('0.000210000000000000');
    expect(cost.feeAssumptions).toEqual({
      method: 'eth_gasPrice',
      gasPriceWei: 10_000_000_000n,
      note: 'test note',
    });
  });
});

describe('exact decimal formatting (no floats)', () => {
  it('converts wei to PHRS exactly', () => {
    expect(formatPhrs(0n)).toBe('0.000000000000000000');
    expect(formatPhrs(10n ** 18n)).toBe('1.000000000000000000');
    expect(formatPhrs(1_234_567_890_123_456_789n)).toBe('1.234567890123456789');
    expect(formatPhrs(210_000_000_000_000n)).toBe('0.000210000000000000');
  });

  it('handles values beyond float precision', () => {
    // 30-digit wei value — impossible to represent exactly as a JS number.
    const huge = 123_456_789_012_345_678_901_234_567_890n; // 123456789012.345678901234567890 PHRS
    expect(formatPhrs(huge)).toBe('123456789012.345678901234567890');
  });

  it('converts wei to gwei exactly', () => {
    expect(formatGwei(10_000_000_000n)).toBe('10.000000000');
    expect(formatGwei(1n)).toBe('0.000000001');
  });

  it('supports other decimal scales via weiToDecimalUnits', () => {
    expect(weiToDecimalUnits(1_500_000n, 6)).toBe('1.500000');
    expect(weiToDecimalUnits(0n, 0)).toBe('0');
  });

  it('keeps sender-after arithmetic exact in the outcome analysis', async () => {
    const { computeNativeTransferOutcome } = await import('../src/analysis/balance-diff.js');
    const input = (await validatedInput());
    const analysis = computeNativeTransferOutcome(
      input,
      277_943_753_174_938_036n,
      0n,
      210_000_000_000_000n,
    );
    expect(analysis.predictedSenderBalanceAfterWei).toBe(276_733_753_174_938_036n);
    expect(analysis.predictedRecipientBalanceAfterWei).toBe(1_000_000_000_000_000n);
  });
});
