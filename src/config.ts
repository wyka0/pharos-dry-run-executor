/**
 * Configuration loading for the Dry-Run Executor.
 *
 * Reads Pharos testnet settings from environment variables (optionally from
 * a local .env file) and validates them. Defaults match the public Pharos
 * Atlantic Testnet endpoint.
 *
 * SAFETY: there is deliberately no private-key setting here. This project is
 * simulation-only and never signs or broadcasts transactions.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const DEFAULT_RPC_URL = 'https://atlantic.dplabs-internal.com';
export const DEFAULT_CHAIN_ID = 688689;
export const DEFAULT_CHAIN_NAME = 'Pharos Atlantic Testnet';
export const DEFAULT_EXPLORER_URL = 'https://atlantic.pharosscan.xyz';

export interface ExecutorConfig {
  rpcUrl: string;
  chainId: number;
  chainName: string;
  explorerUrl?: string;
}

/** Minimal .env loader. Existing process.env values always win. */
export function loadEnvFile(filePath = '.env'): void {
  const full = resolve(filePath);
  if (!existsSync(full)) return;
  const text = readFileSync(full, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key.length === 0) continue;
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/**
 * Loads and validates configuration. Throws Error with a clear message when
 * configuration is invalid (e.g. non-numeric chain ID, non-HTTP RPC URL).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ExecutorConfig {
  const rpcUrl = env.PHAROS_RPC_URL?.trim() || DEFAULT_RPC_URL;
  if (!/^https?:\/\//i.test(rpcUrl)) {
    throw new Error(
      `Invalid PHAROS_RPC_URL "${rpcUrl}": must be an http(s) URL. ` +
        'Simulation requires a reachable JSON-RPC endpoint.',
    );
  }

  const chainIdRaw = env.PHAROS_CHAIN_ID?.trim();
  let chainId = DEFAULT_CHAIN_ID;
  if (chainIdRaw !== undefined && chainIdRaw.length > 0) {
    if (!/^\d+$/.test(chainIdRaw)) {
      throw new Error(
        `Invalid PHAROS_CHAIN_ID "${chainIdRaw}": must be a positive integer (Pharos Atlantic Testnet is ${DEFAULT_CHAIN_ID}).`,
      );
    }
    chainId = Number(chainIdRaw);
    if (!Number.isSafeInteger(chainId) || chainId <= 0) {
      throw new Error(`Invalid PHAROS_CHAIN_ID "${chainIdRaw}": must be a safe positive integer.`);
    }
  }

  const chainName = env.PHAROS_CHAIN_NAME?.trim() || DEFAULT_CHAIN_NAME;
  const explorerUrl = env.PHAROS_EXPLORER_URL?.trim() || DEFAULT_EXPLORER_URL;

  const config: ExecutorConfig = {
    rpcUrl,
    chainId,
    chainName,
  };
  if (explorerUrl.length > 0) {
    config.explorerUrl = explorerUrl;
  }
  return config;
}

/** Loads .env (when present) and returns the validated config. */
export function initConfig(envFilePath = '.env'): ExecutorConfig {
  loadEnvFile(envFilePath);
  return loadConfig();
}
