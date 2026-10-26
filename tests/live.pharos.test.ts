/**
 * OPTIONAL live tests against the real Pharos Atlantic Testnet RPC.
 *
 * Disabled by default. Run explicitly with:
 *   npm run test:live
 *
 * These tests perform read-only RPC calls only (eth_chainId, eth_call,
 * eth_estimateGas, eth_gasPrice, eth_getBalance). They never broadcast.
 * If the endpoint is unreachable, the tests FAIL with the RPC error —
 * results are never fabricated.
 */

import { describe, expect, it } from 'vitest';
import { runDryRun } from '../src/index.js';

const RUN_LIVE = process.env.RUN_LIVE_TESTS === '1';

describe.skipIf(!RUN_LIVE)('live: Pharos Atlantic Testnet (read-only)', () => {
  const SUCCESS_TX = {
    description: 'live native transfer simulation',
    from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    to: '0x000000000000000000000000000000000000dEaD',
    value: '1000000000000000',
    data: '0x',
  };

  const FAILURE_TX = {
    description: 'live USDC transfer from an address holding 0 USDC',
    from: '0x1111111111111111111111111111111111111111',
    to: '0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8',
    value: '0',
    data: '0xa9059cbb000000000000000000000000000000000000000000000000000000000000dead00000000000000000000000000000000000000000000000000000000000f4240',
  };

  it('verifies the Pharos Atlantic chain id (688689)', async () => {
    const report = await runDryRun(SUCCESS_TX);
    expect(report.result.network.chainId).toBe(688689);
    expect(report.result.network.verified).toBe(true);
  });

  it('simulates a valid native transfer and yields GO', async () => {
    const report = await runDryRun(SUCCESS_TX);
    expect(report.result.status).toBe('SUCCESS');
    expect(report.result.complete).toBe(true);
    expect(report.result.gasEstimate).not.toBeNull();
    expect(report.result.outcome).toMatchObject({ kind: 'NATIVE_TRANSFER' });
    expect(report.guard.decision).toBe('GO');
    expect(report.guard.simulationOnly).toBe(true);
  });

  it('simulates a deterministic revert and yields NO_GO', async () => {
    const report = await runDryRun(FAILURE_TX);
    expect(report.result.status).toBe('REVERTED');
    expect(report.guard.decision).toBe('NO_GO');
    expect(
      report.guard.blockers.some((b) => b.code === 'SIMULATION_REVERTED'),
    ).toBe(true);
  });
});
