/**
 * Transaction input validation for the Dry-Run Executor.
 *
 * Validation is strict: malformed transactions are rejected before any RPC
 * call. Invalid inputs are never silently replaced with defaults.
 */

import { getAddress, isAddress } from 'viem';
import type {
  RawTransactionRequest,
  ValidationIssue,
  ValidationResult,
} from '../types.js';

const DECIMAL_RE = /^\d+$/;
const HEX_RE = /^0x[0-9a-fA-F]+$/;
const CALLDATA_RE = /^0x(?:[0-9a-fA-F]{2})*$/;
const DECIMAL_PHRS_RE = /^\d+(?:\.\d+)?$/;
const WEI_DECIMALS = 18n;
const MAX_PHRS_DECIMALS = 18;

function isHexLike(v: unknown): v is string {
  return typeof v === 'string' && (DECIMAL_RE.test(v) || HEX_RE.test(v));
}

/** Parses a wei amount from a decimal or 0x-hex string. Never uses floats. */
export function parseWei(v: string): bigint {
  if (HEX_RE.test(v)) return BigInt(v);
  return BigInt(v); // decimal string — BigInt() is exact
}

/**
 * Parses a human PHRS amount (exact decimal string, e.g. "0.001") into wei
 * using string arithmetic only. Rejects more than 18 fractional digits.
 */
export function parsePhrsToWei(v: string): bigint | null {
  if (!DECIMAL_PHRS_RE.test(v)) return null;
  const parts = v.split('.');
  const intPart = parts[0] ?? '0';
  const fracPart = parts[1] ?? '';
  if (fracPart.length > MAX_PHRS_DECIMALS) return null;
  const scaledInt = BigInt(intPart) * 10n ** WEI_DECIMALS;
  const scaledFrac = fracPart.length > 0 ? BigInt(fracPart.padEnd(MAX_PHRS_DECIMALS, '0')) : 0n;
  return scaledInt + scaledFrac;
}

/**
 * Validates a raw transaction request and normalizes it into a
 * TransactionInput. Returns all issues found (not just the first one).
 */
export function validateTransaction(raw: RawTransactionRequest): ValidationResult {
  const issues: ValidationIssue[] = [];

  // ---- from ----
  if (raw.from === undefined || raw.from === null || raw.from === '') {
    issues.push({ field: 'from', message: 'Required field missing: sender address.' });
  } else if (typeof raw.from !== 'string' || !isAddress(raw.from)) {
    issues.push({
      field: 'from',
      message:
        'Invalid sender address: expected "0x" followed by 40 hexadecimal characters.',
    });
  }

  // ---- to ----
  if (raw.to === undefined || raw.to === null || raw.to === '') {
    issues.push({ field: 'to', message: 'Required field missing: recipient address.' });
  } else if (typeof raw.to !== 'string' || !isAddress(raw.to)) {
    issues.push({
      field: 'to',
      message:
        'Invalid recipient address: expected "0x" followed by 40 hexadecimal characters.',
    });
  }

  // ---- value / valuePhrs ----
  let valueWei: bigint | null = null;
  const hasValue = raw.value !== undefined && raw.value !== null && raw.value !== '';
  const hasValuePhrs = raw.valuePhrs !== undefined && raw.valuePhrs !== null && raw.valuePhrs !== '';

  if (hasValue && hasValuePhrs) {
    issues.push({
      field: 'value',
      message: 'Provide either "value" (wei) or "valuePhrs" (decimal PHRS), not both.',
    });
  } else if (hasValue) {
    if (typeof raw.value === 'number') {
      issues.push({
        field: 'value',
        message:
          'Value must be a string (decimal wei or 0x-hex). Numbers are rejected to avoid floating-point precision loss.',
      });
    } else if (typeof raw.value !== 'string' || !isHexLike(raw.value)) {
      issues.push({
        field: 'value',
        message: 'Invalid value: expected a decimal wei string (e.g. "1000000000000000000") or 0x-hex string.',
      });
    } else {
      valueWei = parseWei(raw.value);
    }
  } else if (hasValuePhrs) {
    if (typeof raw.valuePhrs !== 'string' || parsePhrsToWei(raw.valuePhrs) === null) {
      issues.push({
        field: 'valuePhrs',
        message: 'Invalid valuePhrs: expected an exact decimal PHRS string (e.g. "0.001") with at most 18 decimals.',
      });
    } else {
      valueWei = parsePhrsToWei(raw.valuePhrs as string);
    }
  } else {
    issues.push({ field: 'value', message: 'Required field missing: "value" (wei) or "valuePhrs" (PHRS).' });
  }

  // ---- data ----
  let data: `0x${string}` = '0x';
  if (raw.data !== undefined && raw.data !== null && raw.data !== '') {
    if (typeof raw.data !== 'string' || !CALLDATA_RE.test(raw.data)) {
      issues.push({
        field: 'data',
        message:
          'Invalid calldata: expected a hex string with "0x" prefix and even length (e.g. "0xa9059cbb...").',
      });
    } else {
      data = raw.data.toLowerCase() as `0x${string}`;
    }
  }

  // ---- gasLimit (optional) ----
  let gasLimit: bigint | undefined;
  if (raw.gasLimit !== undefined && raw.gasLimit !== null && raw.gasLimit !== '') {
    if (typeof raw.gasLimit === 'number') {
      issues.push({
        field: 'gasLimit',
        message: 'gasLimit must be a string (decimal gas units or 0x-hex); numbers are rejected.',
      });
    } else if (typeof raw.gasLimit !== 'string' || !isHexLike(raw.gasLimit)) {
      issues.push({
        field: 'gasLimit',
        message: 'Invalid gasLimit: expected a decimal string or 0x-hex string.',
      });
    } else {
      gasLimit = parseWei(raw.gasLimit);
      if (gasLimit <= 0n) {
        issues.push({ field: 'gasLimit', message: 'gasLimit must be greater than zero.' });
      }
    }
  }

  // ---- description (optional) ----
  let description: string | undefined;
  if (raw.description !== undefined && raw.description !== null && raw.description !== '') {
    if (typeof raw.description !== 'string') {
      issues.push({ field: 'description', message: 'description must be a string.' });
    } else {
      description = raw.description;
    }
  }

  if (issues.length > 0) return { ok: false, issues };

  // All required fields validated; normalize addresses to checksum form.
  return {
    ok: true,
    value: {
      from: getAddress(raw.from as string),
      to: getAddress(raw.to as string),
      valueWei: valueWei as bigint,
      data,
      ...(gasLimit !== undefined ? { gasLimit } : {}),
      ...(description !== undefined ? { description } : {}),
    },
  };
}
