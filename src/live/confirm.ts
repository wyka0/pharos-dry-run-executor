/**
 * Live testnet transaction — explicit confirmation gate.
 *
 * The user must type exactly "BROADCAST" (whitespace-trimmed). Anything
 * else — including no input, EOF, a different word, or different case —
 * refuses the broadcast. This gate is a pure function so it can be unit
 * tested without any I/O.
 */

export const CONFIRMATION_PHRASE = 'BROADCAST';

export type ConfirmationResult =
  | { decision: 'CONFIRMED' }
  | { decision: 'REFUSED'; reason: string };

/** Pure gate: exact, case-sensitive phrase match after trimming. */
export function evaluateConfirmation(input: string | null | undefined): ConfirmationResult {
  if (typeof input !== 'string' || input.trim() !== CONFIRMATION_PHRASE) {
    return {
      decision: 'REFUSED',
      reason:
        'Confirmation was absent or incorrect. Nothing was sent. ' +
        `To broadcast, re-run and type ${CONFIRMATION_PHRASE} exactly when prompted.`,
    };
  }
  return { decision: 'CONFIRMED' };
}

/**
 * Reads a confirmation through an injected reader (stdin in production,
 * fakes in tests) and evaluates it. A null return from the reader
 * (EOF / closed stdin) is always a refusal.
 */
export async function readConfirmation(
  reader: () => Promise<string | null>,
): Promise<ConfirmationResult> {
  let answer: string | null;
  try {
    answer = await reader();
  } catch {
    return {
      decision: 'REFUSED',
      reason: 'Confirmation could not be read (input error). Nothing was sent.',
    };
  }
  return evaluateConfirmation(answer);
}
