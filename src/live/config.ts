/**
 * Live testnet transaction — configuration validation.
 *
 * SAFETY:
 * - The private key is read from an environment variable ONLY
 *   (PHAROS_TESTNET_PRIVATE_KEY). It is never returned, logged, or written
 *   to any file by this module. Only the derived sender address leaves it.
 * - The chain is hard-locked to Pharos Atlantic Testnet (688689).
 * - The recipient must be explicitly configured; nothing is assumed.
 */

import { privateKeyToAccount } from 'viem/accounts';
import { getAddress, isAddress } from 'viem';
import { parsePhrsToWei } from '../validation/transaction.js';

export const REQUIRED_CHAIN_ID = 688689;
export const DEFAULT_LIVE_RPC_URL = 'https://atlantic.dplabs-internal.com';
export const DEFAULT_AMOUNT_PHRS = '0.001';
/** Safety cap (whole PHRS): the default use is a tiny test transfer. */
export const MAX_AMOUNT_WHOLE_PHRS = 1n;
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
export const NETWORK_NAME = 'Pharos Atlantic Testnet';

const PRIVATE_KEY_RE = /^0x[0-9a-fA-F]{64}$/;

export interface LiveTxConfig {
  /** Derived sender address (checksummed). The key itself never leaves this module's input. */
  sender: `0x${string}`;
  recipient: `0x${string}`;
  amountWei: bigint;
  /** Exact decimal PHRS string (normalized), e.g. "0.001". */
  amountPhrs: string;
  rpcUrl: string;
  chainId: typeof REQUIRED_CHAIN_ID;
}

export type LiveTxConfigResult =
  | { ok: true; config: LiveTxConfig }
  | { ok: false; errors: string[] };

function weiToPhrsString(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const frac = wei % 10n ** 18n;
  const fracStr = frac === 0n ? '' : '.' + frac.toString().padStart(18, '0').replace(/0+$/, '');
  return whole.toString() + fracStr;
}

/**
 * Validates live-transaction settings from the process environment.
 * Never throws: returns structured errors so the caller can print them and
 * exit without sending anything.
 */
export function loadLiveTxConfig(env: NodeJS.ProcessEnv): LiveTxConfigResult {
  const errors: string[] = [];

  // ---- private key (environment variable only) ----
  const keyRaw = env.PHAROS_TESTNET_PRIVATE_KEY;
  if (keyRaw === undefined || keyRaw.trim().length === 0) {
    errors.push(
      'PHAROS_TESTNET_PRIVATE_KEY is not set. Set it in your shell environment ' +
        '(never in a file, never in git). Example (PowerShell): ' +
        '$env:PHAROS_TESTNET_PRIVATE_KEY="0x..."',
    );
  } else if (!PRIVATE_KEY_RE.test(keyRaw.trim())) {
    errors.push(
      'PHAROS_TESTNET_PRIVATE_KEY is malformed: expected "0x" followed by 64 hexadecimal characters. ' +
        'No transaction was attempted.',
    );
  }

  // ---- recipient (explicit; never assumed) ----
  const recipientRaw = env.PHAROS_TESTNET_RECIPIENT;
  let recipient: `0x${string}` | null = null;
  if (recipientRaw === undefined || recipientRaw.trim().length === 0) {
    errors.push(
      'PHAROS_TESTNET_RECIPIENT is not set. This script never assumes a recipient — ' +
        'configure it explicitly in your environment.',
    );
  } else if (typeof recipientRaw !== 'string' || !isAddress(recipientRaw.trim())) {
    errors.push(
      'PHAROS_TESTNET_RECIPIENT is malformed: expected "0x" followed by 40 hexadecimal characters.',
    );
  } else {
    const checksummed = getAddress(recipientRaw.trim());
    if (checksummed.toLowerCase() === ZERO_ADDRESS) {
      errors.push('PHAROS_TESTNET_RECIPIENT must not be the zero address.');
    } else {
      recipient = checksummed;
    }
  }

  // ---- amount (optional; default 0.001 PHRS; tiny by design) ----
  const amountRaw = env.PHAROS_TESTNET_AMOUNT?.trim() ?? DEFAULT_AMOUNT_PHRS;
  let amountWei: bigint | null = null;
  const parsed = parsePhrsToWei(amountRaw);
  if (parsed === null) {
    errors.push(
      `PHAROS_TESTNET_AMOUNT "${amountRaw}" is invalid: expected an exact decimal PHRS string ` +
        'with at most 18 decimals (e.g. "0.001").',
    );
  } else if (parsed <= 0n) {
    errors.push('PHAROS_TESTNET_AMOUNT must be greater than zero.');
  } else if (parsed > MAX_AMOUNT_WHOLE_PHRS * 10n ** 18n) {
    errors.push(
      `PHAROS_TESTNET_AMOUNT "${amountRaw}" exceeds the safety cap of ${MAX_AMOUNT_WHOLE_PHRS} PHRS. ` +
        'For a larger transfer, edit MAX_AMOUNT_WHOLE_PHRS in src/live/config.ts deliberately.',
    );
  } else {
    amountWei = parsed;
  }

  // ---- RPC URL (optional; default Atlantic testnet RPC) ----
  const rpcUrl = env.PHAROS_TESTNET_RPC_URL?.trim() || DEFAULT_LIVE_RPC_URL;
  if (!/^https?:\/\//i.test(rpcUrl)) {
    errors.push(`PHAROS_TESTNET_RPC_URL "${rpcUrl}" is invalid: must be an http(s) URL.`);
  }

  // ---- chain id: hard-locked to 688689 ----
  const chainIdRaw = env.PHAROS_TESTNET_CHAIN_ID?.trim();
  if (chainIdRaw !== undefined && chainIdRaw.length > 0) {
    if (!/^\d+$/.test(chainIdRaw)) {
      errors.push(`PHAROS_TESTNET_CHAIN_ID "${chainIdRaw}" is invalid: must be an integer.`);
    } else if (Number(chainIdRaw) !== REQUIRED_CHAIN_ID) {
      errors.push(
        `PHAROS_TESTNET_CHAIN_ID is ${chainIdRaw}, but this script is hard-locked to ` +
          `Pharos Atlantic Testnet (${REQUIRED_CHAIN_ID}). Mainnet or any other chain is refused.`,
      );
    }
  }

  if (errors.length > 0 || recipient === null || amountWei === null) {
    return { ok: false, errors };
  }

  // Derive the sender from the key (also proves the key is usable).
  try {
    const account = privateKeyToAccount(keyRaw!.trim() as `0x${string}`);
    return {
      ok: true,
      config: {
        sender: account.address,
        recipient,
        amountWei,
        amountPhrs: weiToPhrsString(amountWei),
        rpcUrl,
        chainId: REQUIRED_CHAIN_ID,
      },
    };
  } catch {
    errors.push(
      'PHAROS_TESTNET_PRIVATE_KEY could not be used to derive an address ' +
        '(invalid secp256k1 scalar). No transaction was attempted.',
    );
    return { ok: false, errors };
  }
}
