/**
 * Unit tests: transaction validation, eth_call simulation, and the full
 * dry-run pipeline — all against fake RPC clients. No network access.
 */

import { describe, expect, it } from 'vitest';
import { runDryRun } from '../src/index.js';
import { simulateCall } from '../src/simulation/simulate.js';
import { validateTransaction } from '../src/validation/transaction.js';
import { createFakeRpc } from './helpers.js';

const VALID_TX = {
  from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  to: '0x000000000000000000000000000000000000dEaD',
  value: '1000000000000000',
  data: '0x',
};

describe('transaction input validation', () => {
  it('accepts a valid native transfer input', () => {
    const result = validateTransaction(VALID_TX);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.valueWei).toBe(1_000_000_000_000_000n);
      expect(result.value.data).toBe('0x');
      expect(result.value.from).toMatch(/^0x[0-9a-fA-F]{40}$/);
    }
  });

  it('accepts valuePhrs and converts it exactly to wei', () => {
    const result = validateTransaction({ ...VALID_TX, value: undefined, valuePhrs: '0.001' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.valueWei).toBe(1_000_000_000_000_000n);
  });

  it('accepts missing data as an empty native transfer', () => {
    const result = validateTransaction({
      from: VALID_TX.from,
      to: VALID_TX.to,
      value: '0',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.data).toBe('0x');
  });

  it('accepts 0x-hex value format', () => {
    const result = validateTransaction({ ...VALID_TX, value: '0x38d7ea4c68000' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.valueWei).toBe(1_000_000_000_000_000n);
  });

  it('rejects an invalid from address', () => {
    const result = validateTransaction({ ...VALID_TX, from: '0x1234' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.field === 'from')).toBe(true);
    }
  });

  it('rejects a missing to address', () => {
    const result = validateTransaction({ from: VALID_TX.from, value: '0' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.field === 'to')).toBe(true);
    }
  });

  it('rejects an invalid checksum/case-mixed address', () => {
    const result = validateTransaction({
      ...VALID_TX,
      to: '0x000000000000000000000000000000000000dEaF', // bad checksum
    });
    expect(result.ok).toBe(false);
  });

  it('rejects calldata with odd length', () => {
    const result = validateTransaction({ ...VALID_TX, data: '0x123' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.field === 'data')).toBe(true);
    }
  });

  it('rejects calldata without the 0x prefix', () => {
    const result = validateTransaction({ ...VALID_TX, data: 'a9059cbb' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.field === 'data')).toBe(true);
    }
  });

  it('rejects calldata with non-hex characters', () => {
    const result = validateTransaction({ ...VALID_TX, data: '0xzz' });
    expect(result.ok).toBe(false);
  });

  it('rejects numeric value (float precision guard)', () => {
    const result = validateTransaction({ ...VALID_TX, value: 1000 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.field === 'value')).toBe(true);
    }
  });

  it('rejects a negative value', () => {
    const result = validateTransaction({ ...VALID_TX, value: '-1' });
    expect(result.ok).toBe(false);
  });

  it('rejects a missing value', () => {
    const result = validateTransaction({ from: VALID_TX.from, to: VALID_TX.to });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.field === 'value')).toBe(true);
    }
  });

  it('rejects value given together with valuePhrs', () => {
    const result = validateTransaction({
      ...VALID_TX,
      valuePhrs: '0.001',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a zero gasLimit', () => {
    const result = validateTransaction({ ...VALID_TX, gasLimit: '0' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.field === 'gasLimit')).toBe(true);
    }
  });
});

describe('simulateCall (eth_call, read-only)', () => {
  it('returns SUCCESS with return data', async () => {
    const client = createFakeRpc({ call: { data: '0xdeadbeef' } });
    const validated = validateTransaction(VALID_TX);
    if (!validated.ok) throw new Error('validation should pass');
    const outcome = await simulateCall(client, validated.value);
    expect(outcome).toEqual({ status: 'SUCCESS', returnData: '0xdeadbeef' });
  });

  it('classifies a revert with data as REVERTED (not RPC error)', async () => {
    const revertError = Object.assign(
      new Error('execution reverted: too expensive'),
      {
        code: 3,
        data:
          '0x08c379a0' +
          '0000000000000000000000000000000000000000000000000000000000000020' +
          '0000000000000000000000000000000000000000000000000000000000000014' +
          '74686174277320746f6f20657870656e73697665000000000000000000000000',
      },
    );
    const client = createFakeRpc({ call: revertError });
    const validated = validateTransaction(VALID_TX);
    if (!validated.ok) throw new Error('validation should pass');
    const outcome = await simulateCall(client, validated.value);
    expect(outcome.status).toBe('REVERTED');
    if (outcome.status === 'REVERTED') {
      expect(outcome.revertData).toContain('08c379a0');
      expect(outcome.decodedReason).toBe("that's too expensive");
    }
  });

  it('classifies a revert without data as REVERTED with reason unavailable', async () => {
    const revertError = Object.assign(new Error('execution reverted: '), { code: 3, data: '0x' });
    const client = createFakeRpc({ call: revertError });
    const validated = validateTransaction(VALID_TX);
    if (!validated.ok) throw new Error('validation should pass');
    const outcome = await simulateCall(client, validated.value);
    expect(outcome.status).toBe('REVERTED');
    if (outcome.status === 'REVERTED') {
      expect(outcome.decodedReason.startsWith('Revert reason unavailable')).toBe(true);
    }
  });

  it('never reports an RPC failure as a contract revert', async () => {
    const rpcError = Object.assign(new Error('fetch failed'), { name: 'HttpRequestError' });
    const client = createFakeRpc({ call: rpcError });
    const validated = validateTransaction(VALID_TX);
    if (!validated.ok) throw new Error('validation should pass');
    const outcome = await simulateCall(client, validated.value);
    expect(outcome.status).toBe('ERROR');
    if (outcome.status === 'ERROR') {
      expect(outcome.failureKind).toBe('RPC');
      expect(outcome.message).toContain('RPC error');
    }
  });
});

describe('runDryRun pipeline', () => {
  it('produces a complete SUCCESS result with predicted balances', async () => {
    const client = createFakeRpc({
      call: { data: '0x' },
      estimateGas: 21_000n,
      gasPrice: 10_000_000_000n,
      balances: {
        '0xd8da6bf26964af9d7eed9e03e53415d37aa96045': 277_943_753_174_938_036n,
        '0x000000000000000000000000000000000000dead': 3_762_145_791_673_329_147n,
      },
    });
    const report = await runDryRun(VALID_TX, { client });
    expect(report.result.status).toBe('SUCCESS');
    expect(report.result.complete).toBe(true);
    expect(report.result.gasEstimate?.gasLimit).toBe(21_000n);
    expect(report.result.outcome).toMatchObject({
      kind: 'NATIVE_TRANSFER',
      predictedSenderBalanceAfterWei: 276_733_753_174_938_036n,
      predictedRecipientBalanceAfterWei: 3_763_145_791_673_329_147n,
      sufficientFunds: true,
    });
    expect(report.guard.decision).toBe('GO');
  });

  it('makes no RPC calls when validation fails', async () => {
    const client = createFakeRpc();
    const report = await runDryRun({ ...VALID_TX, from: 'not-an-address' }, { client });
    expect(report.result.status).toBe('ERROR');
    expect(report.result.failureKind).toBe('VALIDATION');
    expect(report.guard.decision).toBe('NO_GO');
    expect(client.calls).toHaveLength(0);
  });

  it('reports an RPC failure as ERROR/RPC and blocks execution', async () => {
    const rpcError = Object.assign(new Error('fetch failed: ECONNREFUSED'), {
      name: 'HttpRequestError',
    });
    const client = createFakeRpc({ chainError: rpcError });
    const report = await runDryRun(VALID_TX, { client });
    expect(report.result.status).toBe('ERROR');
    expect(report.result.failureKind).toBe('RPC');
    expect(report.result.complete).toBe(false);
    expect(report.guard.decision).toBe('NO_GO');
    expect(report.result.rawError).toContain('unreachable');
  });

  it('fails closed when the RPC reports an unexpected chain id', async () => {
    const client = createFakeRpc({ chainId: 1 });
    const report = await runDryRun(VALID_TX, { client });
    expect(report.result.network.verified).toBe(false);
    expect(report.result.status).toBe('ERROR');
    expect(report.result.failureKind).toBe('RPC');
    expect(report.guard.decision).toBe('NO_GO');
    expect(report.result.network.verificationError).toContain('chain ID mismatch');
  });

  it('blocks a SUCCESS simulation when the sender cannot afford value + gas', async () => {
    // Some nodes (including this Pharos RPC) do not enforce balance inside
    // eth_call — the guard must catch what the node does not.
    const client = createFakeRpc({
      call: { data: '0x' },
      estimateGas: 21_000n,
      gasPrice: 10_000_000_000n,
      balances: {
        '0xd8da6bf26964af9d7eed9e03e53415d37aa96045': 0n,
        '0x000000000000000000000000000000000000dead': 0n,
      },
    });
    const report = await runDryRun(VALID_TX, { client });
    expect(report.result.status).toBe('SUCCESS');
    expect(report.result.outcome).toMatchObject({ sufficientFunds: false });
    expect(report.result.complete).toBe(false);
    expect(report.guard.decision).toBe('NO_GO');
    expect(
      report.guard.blockers.some((b) => b.code === 'INSUFFICIENT_PREDICTED_FUNDS'),
    ).toBe(true);
  });
});
