/**
 * Execution guard for the Dry-Run Executor.
 *
 * The guard converts a SimulationResult into a GO / NO_GO decision:
 *   - Only a complete, successful simulation yields GO.
 *   - Reverts, RPC errors, gas estimation failures, validation failures,
 *     unverified networks, and incomplete/uncertain results all yield NO_GO
 *     with an explicit reason.
 *
 * SAFETY: the guard is a pure decision function. It never executes, signs,
 * or broadcasts anything. Even a GO decision must not lead to a broadcast —
 * "GO means simulation passed. No transaction was sent."
 */

import type { GuardBlocker, GuardResult, SimulationResult } from '../types.js';

export const GO_MESSAGE = 'GO means simulation passed. No transaction was sent.' as const;
export const NO_GO_MESSAGE = 'NO_GO — execution blocked' as const;

function blocker(code: string, detail: string): GuardBlocker {
  return { code, detail };
}

/**
 * Evaluates the execution guard against a simulation result.
 * GO requires: status SUCCESS, complete === true, verified network,
 * a gas estimate, and no uncertainty. Everything else is NO_GO.
 */
export function evaluateExecutionGuard(result: SimulationResult): GuardResult {
  const blockers: GuardBlocker[] = [];

  if (result.status === 'REVERTED') {
    blockers.push(
      blocker(
        'SIMULATION_REVERTED',
        `The simulated transaction reverts: ${result.revert?.displayReason ?? 'reason unavailable'}.`,
      ),
    );
  }

  if (result.status === 'ERROR') {
    const kind = result.failureKind ?? 'UNKNOWN';
    const detail =
      kind === 'RPC'
        ? 'RPC unavailable or unusable — no simulation was performed.'
        : kind === 'GAS_ESTIMATION'
          ? 'Gas estimation failed.'
          : kind === 'VALIDATION'
            ? 'Transaction input failed validation.'
            : 'Simulation ended in an unknown error.';
    blockers.push(blocker(`SIMULATION_ERROR_${kind}`, detail));
  }

  if (!result.network.verified) {
    blockers.push(
      blocker(
        'NETWORK_NOT_VERIFIED',
        result.network.verificationError ?? 'RPC network could not be verified.',
      ),
    );
  }

  if (result.gasEstimate === null) {
    blockers.push(
      blocker(
        'MISSING_GAS_ESTIMATE',
        result.gasEstimateError ?? 'Gas estimate is missing; cost cannot be bounded.',
      ),
    );
  }

  if (result.outcome?.kind === 'NATIVE_TRANSFER' && !result.outcome.sufficientFunds) {
    blockers.push(
      blocker(
        'INSUFFICIENT_PREDICTED_FUNDS',
        'Sender balance does not cover value + estimated gas cost; SUCCESS here is not trustworthy.',
      ),
    );
  }

  if (!result.complete && blockers.length === 0) {
    blockers.push(
      blocker(
        'INCOMPLETE_RESULT',
        'Simulation result is incomplete or uncertain; failing closed.',
      ),
    );
  }

  const go = result.status === 'SUCCESS' && result.complete && blockers.length === 0;

  if (go) {
    return {
      decision: 'GO',
      reason: 'Simulation succeeded on-chain state as of the simulation block; gas and cost estimated; no blocking condition found.',
      blockers: [],
      decidedAtIso: new Date().toISOString(),
      simulationOnly: true,
    };
  }

  const reason =
    blockers.length === 1
      ? blockers[0]!.detail
      : `${blockers.length} blocking conditions: ${blockers.map((b) => b.code).join(', ')}.`;

  return {
    decision: 'NO_GO',
    reason,
    blockers,
    decidedAtIso: new Date().toISOString(),
    simulationOnly: true,
  };
}
