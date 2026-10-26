/**
 * RPC error classification for the Dry-Run Executor.
 *
 * The simulator must clearly distinguish:
 *   - Simulation revert   (the simulated transaction would fail on-chain)
 *   - RPC error           (the endpoint is down / returned an infra error)
 *   - Gas estimation failure
 *
 * An RPC failure must never be reported as a contract revert, and a revert
 * must never be hidden behind a generic RPC error.
 */

export type ErrorKind = 'RPC' | 'SIMULATION_EXECUTION';

/** Thrown when the RPC endpoint is unreachable or unusable. */
export class RpcUnavailableError extends Error {
  override readonly name = 'RpcUnavailableError';
  readonly kind: ErrorKind = 'RPC';

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

/** Thrown when the RPC answered with a JSON-RPC error we cannot attribute to the simulated tx. */
export class RpcResponseError extends Error {
  override readonly name = 'RpcResponseError';
  readonly kind: ErrorKind = 'RPC';
  readonly code: number | null;

  constructor(message: string, code: number | null = null, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

const HEX_DATA = /^0x[0-9a-fA-F]*$/;

function findHexData(err: unknown, depth = 0): string | null {
  if (depth > 5 || !isRecord(err)) return null;
  const direct = err.data;
  if (typeof direct === 'string' && HEX_DATA.test(direct) && direct !== '0x') return direct;
  const cause = err.cause;
  return findHexData(cause, depth + 1);
}

function collectMessage(err: unknown, depth = 0): string {
  if (depth > 5 || !isRecord(err)) return '';
  const parts: string[] = [];
  if (typeof err.message === 'string') parts.push(err.message);
  if (typeof err.details === 'string') parts.push(err.details);
  if (typeof err.shortMessage === 'string') parts.push(err.shortMessage);
  const nested = collectMessage(err.cause, depth + 1);
  if (nested.length > 0) parts.push(nested);
  return parts.filter((p) => p.length > 0).join(' | ');
}

const RPC_INFRA_PATTERNS =
  /fetch failed|ECONNREFUSED|ENOTFOUND|ECONNRESET|ETIMEDOUT|socket hang up|aborted|network|dns|certificate|self-signed|status 4\d\d|status 5\d\d|rate.?limit|too many requests|service unavailable|bad gateway|gateway time-?out|internal server error|not found/i;

const EXECUTION_PATTERNS =
  /revert|insufficient funds|out of gas|exceeds block gas limit|intrinsic gas too low|gas required exceeds allowance|stack underflow|invalid opcode|out of range|overflow/i;

export interface ClassifiedError {
  kind: ErrorKind;
  /** Revert data hex (without trailing empties) when the node returned any. */
  revertData: `0x${string}` | null;
  /** Best-effort raw message for reports. */
  message: string;
  /** JSON-RPC error code when available (3 = execution revert on most nodes). */
  code: number | null;
}

/**
 * Classifies any error thrown by an RPC call into either an execution-level
 * failure of the *simulated transaction* (kind SIMULATION_EXECUTION) or an
 * infrastructure problem (kind RPC).
 */
export function classifyRpcError(err: unknown): ClassifiedError {
  const message = compactMessage(collectMessage(err), 400);
  const revertData = findHexData(err);
  const code = isRecord(err) && typeof err.code === 'number' ? err.code : null;
  const name = isRecord(err) && typeof err.name === 'string' ? err.name : '';
  const causeName = isRecord(err) && isRecord(err.cause) && typeof err.cause.name === 'string' ? err.cause.name : '';

  // Explicit revert data from the node: the simulated transaction failed.
  if (revertData !== null) {
    return {
      kind: 'SIMULATION_EXECUTION',
      revertData: revertData as `0x${string}`,
      message,
      code,
    };
  }

  // viem wraps node-side execution failures in *ExecutionError classes.
  if (/ExecutionError$/.test(name) || /ExecutionError$/.test(causeName)) {
    return { kind: 'SIMULATION_EXECUTION', revertData: null, message, code };
  }

  if (EXECUTION_PATTERNS.test(message)) {
    return { kind: 'SIMULATION_EXECUTION', revertData: null, message, code };
  }

  if (
    name === 'HttpRequestError' ||
    name === 'TimeoutError' ||
    name === 'RpcUnavailableError' ||
    RPC_INFRA_PATTERNS.test(message)
  ) {
    return { kind: 'RPC', revertData: null, message, code };
  }

  // Default to RPC: unclassified failures must block execution rather than
  // being mistaken for a contract revert.
  return { kind: 'RPC', revertData: null, message, code: code ?? null };
}

/** Collapses a (possibly huge, multi-line) error message into one compact line. */
export function compactMessage(message: string, maxLen = 400): string {
  const collapsed = message.replace(/\s+/g, ' ').trim();
  // De-duplicate repeated segments caused by viem's cause-chain wrapping.
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const part of collapsed.split('|')) {
    const key = part.trim();
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    parts.push(key);
  }
  const joined = parts.join(' | ');
  if (joined.length <= maxLen) return joined;
  return joined.slice(0, maxLen) + '…(truncated)';
}

/** Renders any thrown value into a short single-line string for reports. */
export function describeError(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : (() => {
            try {
              return JSON.stringify(err);
            } catch {
              return String(err);
            }
          })();
  return compactMessage(raw);
}
