/**
 * Revert reason decoding for the Dry-Run Executor.
 *
 * Decodes the two common EVM revert formats:
 *   - Error(string)   selector 0x08c379a0
 *   - Panic(uint256)  selector 0x4e487b71
 *
 * Anything else (custom errors, empty data, malformed payloads) is reported
 * as UNDECODABLE with the message "Revert reason unavailable". The decoder
 * never invents a revert reason.
 */

import type { DecodedRevert } from '../types.js';

const ERROR_STRING_SELECTOR = '0x08c379a0';
const PANIC_SELECTOR = '0x4e487b71';
export const REASON_UNAVAILABLE = 'Revert reason unavailable' as const;

/** Well-known Solidity panic codes (Solidity >= 0.8). */
const PANIC_NAMES: ReadonlyMap<bigint, string> = new Map([
  [0x00n, 'Generic panic (compiler inserted)'],
  [0x01n, 'Assert failed (assert(false))'],
  [0x11n, 'Arithmetic operation underflowed or overflowed'],
  [0x12n, 'Division or modulo by zero'],
  [0x21n, 'Value too big or negative when converted to an enum type'],
  [0x22n, 'Invalid storage byte array access'],
  [0x31n, 'Called .pop() on an empty array'],
  [0x32n, 'Array slice out of bounds'],
  [0x41n, 'Allocated too much memory or created an array that is too large'],
  [0x51n, 'Called a zero-initialized variable of internal function type'],
]);

function decodeAbiString(data: Uint8Array): string {
  // Layout: uint256 offset (from start of args) | uint256 length | bytes
  if (data.length < 64) throw new Error('string payload too short');
  const readWord = (start: number): bigint => {
    let acc = 0n;
    for (let i = 0; i < 32; i++) acc = (acc << 8n) | BigInt(data[start + i] as number);
    return acc;
  };
  const offset = readWord(0);
  if (offset !== 32n) throw new Error('unexpected string offset');
  const length = readWord(32);
  if (length > 4096n) throw new Error('string length unreasonably large');
  const start = 64;
  const end = start + Number(length);
  if (end > data.length) throw new Error('string length out of bounds');
  return new TextDecoder('utf-8', { fatal: false }).decode(data.subarray(start, end));
}

function decodeAbiUint256(data: Uint8Array): bigint {
  if (data.length < 32) throw new Error('uint256 payload too short');
  let acc = 0n;
  for (let i = 0; i < 32; i++) acc = (acc << 8n) | BigInt(data[i] as number);
  return acc;
}

/**
 * Decodes raw revert data. Returns null when there is no revert data at all
 * (null or '0x'), which callers must surface as "Revert reason unavailable".
 */
export function decodeRevertData(data: `0x${string}` | null): DecodedRevert | null {
  if (data === null || data === '0x' || data.length < 10) {
    return null;
  }
  const selector = data.slice(0, 10).toLowerCase();
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(
      (data.slice(10).match(/.{2}/g) ?? []).map((pair) => parseInt(pair, 16)),
    );
  } catch {
    return { kind: 'UNDECODABLE', raw: data, message: REASON_UNAVAILABLE };
  }

  if (selector === ERROR_STRING_SELECTOR) {
    try {
      const message = decodeAbiString(bytes);
      return { kind: 'Error(string)', message, raw: data };
    } catch {
      return { kind: 'UNDECODABLE', raw: data, message: REASON_UNAVAILABLE };
    }
  }

  if (selector === PANIC_SELECTOR) {
    try {
      const code = decodeAbiUint256(bytes);
      const panicName = PANIC_NAMES.get(code) ?? 'Unknown Solidity panic code';
      return { kind: 'Panic(uint256)', panicCode: code, panicName, raw: data };
    } catch {
      return { kind: 'UNDECODABLE', raw: data, message: REASON_UNAVAILABLE };
    }
  }

  return { kind: 'UNDECODABLE', raw: data, message: REASON_UNAVAILABLE };
}

/**
 * Builds a RevertInfo-like display reason from raw revert data:
 * a decoded human message, or "Revert reason unavailable" + raw hex.
 */
export function describeRevertData(revertData: `0x${string}` | null): {
  decoded: DecodedRevert | null;
  displayReason: string;
} {
  const decoded = decodeRevertData(revertData);
  if (decoded === null) {
    const rawSuffix = revertData && revertData !== '0x' ? ` (raw revert data: ${revertData})` : '';
    return { decoded: null, displayReason: REASON_UNAVAILABLE + rawSuffix };
  }
  if (decoded.kind === 'Error(string)') {
    return { decoded, displayReason: decoded.message };
  }
  if (decoded.kind === 'Panic(uint256)') {
    return { decoded, displayReason: `Panic(0x${toHexBE(decoded.panicCode)}): ${decoded.panicName}` };
  }
  return {
    decoded,
    displayReason: `${REASON_UNAVAILABLE} (raw revert data: ${decoded.raw})`,
  };
}

function toHexBE(v: bigint): string {
  return v.toString(16);
}
