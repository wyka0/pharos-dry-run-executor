/**
 * Unit tests: the execution guard. Proves that only a complete, successful
 * simulation yields GO — and that even a GO decision never leads to a
 * broadcast (no send/sign method exists or is ever called).
 */

import { describe, expect, it } from 'vitest';
import { runDryRun } from '../src/index.js';
import { GO_MESSAGE, evaluateExecutionGuard } from '../src/execution/execution-guard.js';
import { ALLOWED_RPC_METHODS, createFakeRpc, makeResult } from './helpers.js';

describe('execution guard — GO', () => {
  it('allows GO for a complete successful simulation', () => {
    const guard = evaluateExecutionGuard(makeResult());
    expect(guard.decision).toBe('GO');
    expect(guard.blockers).toHaveLength(0);
    expect(guard.simulationOnly).toBe(true);
  });

  it('denies GO when the status is SUCCESS but the result is incomplete', () => {
    const guard = evaluateExecutionGuard(makeResult({ complete: false }));
    expect(guard.decision).toBe('NO_GO');
    expect(guard.blockers.map((b) => b.code)).toContain('INCOMPLETE_RESULT');
  });
});

describe('execution guard — reverts block execution', () => {
  it('blocks REVERTED simulations', () => {
    const guard = evaluateExecutionGuard(
      makeResult({
        status: 'REVERTED',
        complete: true,
        returnData: null,
        revert: {
          revertData: '0x',
          decoded: null,
          displayReason: 'Revert reason unavailable',
        },
      }),
    );
    expect(guard.decision).toBe('NO_GO');
    expect(guard.blockers.map((b) => b.code)).toContain('SIMULATION_REVERTED');
    expect(guard.reason).toContain('reverts');
  });
});

describe('execution guard — errors block execution', () => {
  const cases: Array<{ kind: 'RPC' | 'GAS_ESTIMATION' | 'VALIDATION' | 'UNKNOWN'; code: string }> = [
    { kind: 'RPC', code: 'SIMULATION_ERROR_RPC' },
    { kind: 'GAS_ESTIMATION', code: 'SIMULATION_ERROR_GAS_ESTIMATION' },
    { kind: 'VALIDATION', code: 'SIMULATION_ERROR_VALIDATION' },
    { kind: 'UNKNOWN', code: 'SIMULATION_ERROR_UNKNOWN' },
  ];
  for (const { kind, code } of cases) {
    it(`blocks ERROR results with failureKind ${kind}`, () => {
      const guard = evaluateExecutionGuard(
        makeResult({ status: 'ERROR', complete: false, failureKind: kind, rawError: 'boom' }),
      );
      expect(guard.decision).toBe('NO_GO');
      expect(guard.blockers.map((b) => b.code)).toContain(code);
    });
  }

  it('blocks when gas estimation failed despite a successful eth_call', () => {
    const guard = evaluateExecutionGuard(
      makeResult({
        complete: false,
        gasEstimate: null,
        gasEstimateError: 'Gas estimation failed: the transaction is unlikely to execute',
      }),
    );
    expect(guard.decision).toBe('NO_GO');
    expect(guard.blockers.map((b) => b.code)).toContain('MISSING_GAS_ESTIMATE');
  });

  it('blocks when the network could not be verified', () => {
    const guard = evaluateExecutionGuard(
      makeResult({
        network: {
          chainId: 688689,
          chainName: 'Pharos Atlantic Testnet',
          rpcUrl: 'https://atlantic.dplabs-internal.com',
          blockNumber: null,
          verified: false,
          verificationError: 'RPC endpoint unreachable (fetch failed).',
        },
      }),
    );
    expect(guard.decision).toBe('NO_GO');
    expect(guard.blockers.map((b) => b.code)).toContain('NETWORK_NOT_VERIFIED');
  });

  it('blocks when the sender cannot cover value + gas (uncertain SUCCESS)', () => {
    const guard = evaluateExecutionGuard(
      makeResult({
        complete: false,
        outcome: {
          kind: 'NATIVE_TRANSFER',
          senderBalanceBeforeWei: 0n,
          recipientBalanceBeforeWei: 0n,
          transferValueWei: 1_000_000_000_000_000n,
          gasCostWei: 210_000_000_000_000n,
          predictedSenderBalanceAfterWei: null,
          predictedRecipientBalanceAfterWei: 1_000_000_000_000_000n,
          sufficientFunds: false,
          warnings: [],
        },
      }),
    );
    expect(guard.decision).toBe('NO_GO');
    expect(guard.blockers.map((b) => b.code)).toContain('INSUFFICIENT_PREDICTED_FUNDS');
  });
});

describe('simulation-only guarantee', () => {
  const GO_TX = {
    from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    to: '0x000000000000000000000000000000000000dEaD',
    value: '1000000000000000',
    data: '0x',
  };

  it('a fully successful simulation still does not broadcast', async () => {
    const client = createFakeRpc({
      call: { data: '0x' },
      estimateGas: 21_000n,
      gasPrice: 10_000_000_000n,
      balances: {
        '0xd8da6bf26964af9d7eed9e03e53415d37aa96045': 277_943_753_174_938_036n,
        '0x000000000000000000000000000000000000dead': 0n,
      },
    });

    // The fake client structurally has no broadcast/sign methods at all.
    const fakeAsRecord = client as unknown as Record<string, unknown>;
    for (const forbidden of [
      'sendTransaction',
      'sendRawTransaction',
      'sendRawTransactionSync',
      'signTransaction',
      'signMessage',
      'signTypedData',
      'writeContract',
      'deployContract',
      'broadcast',
    ]) {
      expect(fakeAsRecord[forbidden]).toBeUndefined();
    }

    const report = await runDryRun(GO_TX, { client });

    // Only read-only methods were ever invoked.
    for (const method of client.calls) {
      expect(ALLOWED_RPC_METHODS.has(method)).toBe(true);
    }
    expect(client.calls).not.toContain('call_tx'); // paranoia: no unknown method names

    // Even with a GO decision, nothing was sent.
    expect(report.guard.decision).toBe('GO');
    expect(report.guard.simulationOnly).toBe(true);
    expect(report.result.simulationOnly).toBe(true);
    expect(report.guard.reason).not.toContain('sent');
    expect(GO_MESSAGE).toContain('No transaction was sent');
  });

  it('a failed simulation cannot pass the guard', async () => {
    const revertError = Object.assign(new Error('execution reverted: '), { code: 3, data: '0x' });
    const client = createFakeRpc({ call: revertError });
    const report = await runDryRun(GO_TX, { client });
    expect(report.result.status).toBe('REVERTED');
    expect(report.guard.decision).toBe('NO_GO');
    expect(report.guard.simulationOnly).toBe(true);
    for (const method of client.calls) {
      expect(ALLOWED_RPC_METHODS.has(method)).toBe(true);
    }
  });
});
