/**
 * Report rendering for the Dry-Run Executor.
 *
 * Produces a deterministic human-readable text report (and JSON). All
 * predicted values are clearly labeled "PREDICTED — NOT CONFIRMED", and the
 * report always states that nothing was broadcast.
 */

import { formatGwei, formatPhrs } from '../simulation/calculate-cost.js';
import { PREDICTED_LABEL, STATE_CHANGES_NOTE } from './balance-diff.js';
import type { DryRunReport, SimulationResult } from '../types.js';

const RULE = '═'.repeat(72);

export interface RenderOptions {
  /**
   * Label for the input section, e.g. 'FIXTURE — NOT LIVE' when the input
   * was loaded from an example file, or 'BUILT-IN EXAMPLE'.
   */
  inputSourceLabel: string;
}

function fmtWei(wei: bigint | null): string {
  return wei === null ? 'n/a' : wei.toString();
}

function fmtPhrs(wei: bigint | null): string {
  return wei === null ? 'n/a' : `${formatPhrs(wei)} PHRS`;
}

function renderInput(result: SimulationResult, opts: RenderOptions): string[] {
  const lines: string[] = [];
  lines.push('INPUT TRANSACTION');
  lines.push(`  source:      ${opts.inputSourceLabel}`);
  if (result.description !== null) {
    lines.push(`  description: ${result.description}`);
  }
  lines.push(`  from:        ${result.input.from}`);
  lines.push(`  to:          ${result.input.to}`);
  lines.push(`  value:       ${fmtWei(result.input.valueWei)} wei (${fmtPhrs(result.input.valueWei)})`);
  const data = result.input.data;
  lines.push(`  data:        ${data === '0x' ? '(empty — native transfer)' : data}`);
  lines.push(
    `  gasLimit:    ${result.input.gasLimit !== undefined ? result.input.gasLimit.toString() + ' (user-supplied)' : '(not specified — will estimate)'}`,
  );
  return lines;
}

function renderNetwork(result: SimulationResult): string[] {
  const n = result.network;
  return [
    'NETWORK (live read-only RPC)',
    `  chain:       ${n.chainId} — ${n.chainName}`,
    `  rpc:         ${n.rpcUrl}`,
    ...(n.explorerUrl ? [`  explorer:    ${n.explorerUrl}`] : []),
    `  block:       ${n.blockNumber === null ? 'unavailable' : n.blockNumber.toString()}`,
    `  verified:    ${n.verified ? 'yes' : `NO — ${n.verificationError ?? 'unknown reason'}`}`,
  ];
}

function renderSimulation(result: SimulationResult): string[] {
  const lines: string[] = [];
  lines.push('SIMULATION (eth_call — read-only, nothing broadcast)');
  lines.push(`  status:      ${result.status}`);
  if (result.status === 'SUCCESS') {
    lines.push(
      `  returnData:  ${result.returnData ?? '(empty)'}`,
    );
  }
  if (result.revert !== null) {
    lines.push(`  revert:      ${result.revert.displayReason}`);
    if (result.revert.decoded !== null) {
      lines.push(`  decoded as:  ${result.revert.decoded.kind}`);
    }
  }
  if (result.failureKind !== null) {
    lines.push(`  failureKind: ${result.failureKind}`);
  }
  if (result.rawError !== null) {
    lines.push(`  raw error:   ${result.rawError}`);
  }
  for (const w of result.warnings) {
    lines.push(`  warning:     ${w}`);
  }
  return lines;
}

function renderGas(result: SimulationResult): string[] {
  const lines: string[] = ['GAS'];
  const g = result.gasEstimate;
  if (g === null) {
    lines.push(
      result.gasEstimateError !== null
        ? `  estimate:    UNAVAILABLE — ${result.gasEstimateError}`
        : '  estimate:    UNAVAILABLE',
    );
    return lines;
  }
  lines.push(
    `  gasLimit:    ${g.gasLimit.toString()} gas units`,
    `  gasPrice:    ${g.gasPriceWei.toString()} wei/gas (${formatGwei(g.gasPriceWei)} gwei)`,
    `  gasCost:     ${g.gasCostWei.toString()} wei (${g.gasCostPhrs} PHRS)`,
    `  assumption:  ${g.feeAssumptions.method} — ${g.feeAssumptions.note}`,
  );
  return lines;
}

function renderOutcome(result: SimulationResult): string[] {
  const lines: string[] = [];
  const o = result.outcome;
  if (o === null) {
    lines.push('EXPECTED OUTCOME');
    lines.push('  State changes not fully available from simulation');
    return lines;
  }
  if (o.kind === 'CONTRACT_CALL') {
    lines.push('EXPECTED OUTCOME (contract call)');
    lines.push(`  target:      ${o.target}`);
    lines.push(`  calldata:    ${o.calldata}`);
    lines.push(`  ${o.note}`);
    return lines;
  }
  lines.push(`EXPECTED OUTCOME (${PREDICTED_LABEL})`);
  lines.push(`  sender balance before:    ${o.senderBalanceBeforeWei.toString()} wei (${fmtPhrs(o.senderBalanceBeforeWei)})`);
  if (o.predictedSenderBalanceAfterWei === null) {
    lines.push('  sender balance after:     n/a — insufficient funds for value + estimated gas');
  } else {
    lines.push(
      `  sender balance after:     ${o.predictedSenderBalanceAfterWei.toString()} wei (${fmtPhrs(o.predictedSenderBalanceAfterWei)})  [PREDICTED — NOT CONFIRMED]`,
    );
  }
  lines.push(
    `  recipient balance before: ${o.recipientBalanceBeforeWei.toString()} wei (${fmtPhrs(o.recipientBalanceBeforeWei)})`,
  );
  lines.push(
    `  recipient balance after:  ${o.predictedRecipientBalanceAfterWei.toString()} wei (${fmtPhrs(o.predictedRecipientBalanceAfterWei)})  [PREDICTED — NOT CONFIRMED]`,
  );
  lines.push(`  value transferred:        ${o.transferValueWei.toString()} wei`);
  lines.push(`  estimated gas cost:       ${o.gasCostWei.toString()} wei`);
  for (const w of o.warnings) lines.push(`  warning:     ${w}`);
  return lines;
}

function renderGuard(report: DryRunReport): string[] {
  const g = report.guard;
  const lines: string[] = ['EXECUTION GUARD (simulation-only)'];
  lines.push(`  decision:    ${g.decision}`);
  lines.push(`  reason:      ${g.reason}`);
  for (const b of g.blockers) {
    lines.push(`  blocker:     [${b.code}] ${b.detail}`);
  }
  if (g.decision === 'GO') {
    lines.push('  GO means simulation passed. No transaction was sent.');
  } else {
    lines.push('  NO_GO — execution blocked');
  }
  return lines;
}

/** Renders the full human-readable dry-run report. */
export function renderReport(report: DryRunReport, opts: RenderOptions): string {
  const r = report.result;
  const lines: string[] = [];
  lines.push(RULE);
  lines.push('DRY-RUN EXECUTOR — TRANSACTION SIMULATION REPORT');
  lines.push('SIMULATION ONLY — NO TRANSACTION IS EVER SENT OR BROADCAST');
  lines.push(RULE);
  lines.push(...renderInput(r, opts));
  lines.push('');
  lines.push(...renderNetwork(r));
  lines.push('');
  lines.push(...renderSimulation(r));
  lines.push('');
  lines.push(...renderGas(r));
  lines.push('');
  lines.push(...renderOutcome(r));
  if (r.balanceReads !== null && r.balanceReads.errors.length > 0) {
    lines.push('');
    lines.push('BALANCE READ ERRORS');
    for (const e of r.balanceReads.errors) lines.push(`  ${e}`);
  }
  lines.push('');
  lines.push(...renderGuard(report));
  lines.push('');
  lines.push(
    'DISCLAIMER: A passing simulation is a point-in-time prediction, not a guarantee. ' +
      'Network state changes between simulation and any future execution. ' +
      'This tool never sends transactions.',
  );
  lines.push(RULE);
  return lines.join('\n');
}

/** JSON-safe view of the report (BigInt values become strings). */
export function renderJson(report: DryRunReport, opts: RenderOptions): string {
  const payload = {
    inputSourceLabel: opts.inputSourceLabel,
    simulationOnly: true,
    result: report.result,
    guard: report.guard,
  };
  return JSON.stringify(
    payload,
    (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value),
    2,
  );
}

export { PREDICTED_LABEL, STATE_CHANGES_NOTE };
