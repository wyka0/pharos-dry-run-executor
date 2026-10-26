/**
 * Unit tests: report rendering. Verifies the mandated labels, the
 * GO/NO_GO messaging, and JSON serialization of BigInt values.
 */

import { describe, expect, it } from 'vitest';
import { renderJson, renderReport } from '../src/analysis/report.js';
import { evaluateExecutionGuard } from '../src/execution/execution-guard.js';
import { makeResult } from './helpers.js';

function buildReport(overrides = {}, label = 'BUILT-IN EXAMPLE') {
  const result = makeResult(overrides);
  return { report: { result, guard: evaluateExecutionGuard(result) }, label };
}

describe('renderReport — GO', () => {
  it('contains the required labels and messages', () => {
    const { report, label } = buildReport();
    const text = renderReport(report, { inputSourceLabel: label });
    expect(text).toContain('SIMULATION ONLY');
    expect(text).toContain('PREDICTED — NOT CONFIRMED');
    expect(text).toContain('GO means simulation passed. No transaction was sent.');
    expect(text).toContain('decision:    GO');
    expect(text).toContain('0.000210000000000000 PHRS');
    expect(text).toContain('21000');
  });

  it('shows the fixture label when the input comes from a file', () => {
    const { report } = buildReport();
    const text = renderReport(report, {
      inputSourceLabel: 'FIXTURE — NOT LIVE (input loaded from file; simulation below runs against live RPC)',
    });
    expect(text).toContain('FIXTURE — NOT LIVE');
  });

  it('shows predicted sender and recipient balances for native transfers', () => {
    const { report } = buildReport();
    const text = renderReport(report, { inputSourceLabel: 'test' });
    expect(text).toContain('sender balance before:');
    expect(text).toContain('sender balance after:');
    expect(text).toContain('recipient balance after:');
  });
});

describe('renderReport — NO_GO', () => {
  it('contains the blocked-execution message for reverts', () => {
    const { report } = buildReport({
      status: 'REVERTED',
      complete: true,
      returnData: null,
      revert: { revertData: '0x', decoded: null, displayReason: 'Revert reason unavailable' },
    });
    const text = renderReport(report, { inputSourceLabel: 'test' });
    expect(text).toContain('NO_GO — execution blocked');
    expect(text).toContain('status:      REVERTED');
    expect(text).toContain('Revert reason unavailable');
  });

  it('states that state changes are not available for contract calls', () => {
    const { report } = buildReport({
      outcome: {
        kind: 'CONTRACT_CALL',
        target: '0x838800b758277CC111B2d48Ab01e5E164f8E9471',
        calldata: '0x95d89b41',
        note: 'State changes not fully available from simulation',
      },
    });
    const text = renderReport(report, { inputSourceLabel: 'test' });
    expect(text).toContain('State changes not fully available from simulation');
  });

  it('reports gas estimate unavailability when gas estimation fails', () => {
    const { report } = buildReport({
      complete: false,
      gasEstimate: null,
      gasEstimateError: 'Gas estimation failed',
      outcome: null,
    });
    const text = renderReport(report, { inputSourceLabel: 'test' });
    expect(text).toContain('UNAVAILABLE');
    expect(text).toContain('NO_GO — execution blocked');
  });

  it('reports validation failures with the issue list', () => {
    const { report } = buildReport({
      status: 'ERROR',
      complete: false,
      failureKind: 'VALIDATION',
      rawError: '[from] Invalid sender address',
      validationIssues: [{ field: 'from', message: 'Invalid sender address' }],
      gasEstimate: null,
      outcome: null,
      balanceReads: null,
    });
    const text = renderReport(report, { inputSourceLabel: 'test' });
    expect(text).toContain('[from] Invalid sender address');
    expect(text).toContain('failureKind: VALIDATION');
  });
});

describe('renderJson', () => {
  it('produces parseable JSON with BigInt values as strings', () => {
    const { report } = buildReport();
    const json = renderJson(report, { inputSourceLabel: 'FIXTURE — NOT LIVE' });
    const parsed: unknown = JSON.parse(json);
    expect(parsed).toMatchObject({
      simulationOnly: true,
      result: { status: 'SUCCESS', complete: true },
      guard: { decision: 'GO' },
    });
    const obj = parsed as { result: { input: { valueWei: string }; gasEstimate: { gasCostWei: string } } };
    expect(obj.result.input.valueWei).toBe('1000000000000000');
    expect(obj.result.gasEstimate.gasCostWei).toBe('210000000000000');
  });
});
