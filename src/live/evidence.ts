/**
 * Live testnet transaction — evidence file builders (pure functions).
 *
 * The builders receive only the fields explicitly listed below. The private
 * key never reaches this module, so it can never appear in the evidence.
 * Every value is captured from the actual RPC transaction and receipt.
 */

import { formatPhrs } from '../simulation/calculate-cost.js';

export interface EvidenceData {
  timestampIso: string;
  broadcastAtIso: string;
  networkName: string;
  chainId: number;
  rpcUrl: string;
  sender: string;
  recipient: string;
  amountWei: string;
  amountPhrs: string;
  transactionHash: string;
  blockNumber: string | null;
  receiptStatus: string;
  gasUsed: string | null;
  effectiveGasPriceWei: string | null;
  actualFeeWei: string | null;
  actualFeePhrs: string | null;
  /** Included only when the explorer base URL was actually reachable. */
  explorerUrl: string | null;
  explorerVerified: boolean;
  /** Included only when actually computed from block numbers. */
  confirmations: string | null;
  preBroadcastSimulation: { status: string; guardDecision: string } | null;
}

const SECRET_PATTERNS: RegExp[] = [
  /"privateKey"\s*:/i,
  /PHAROS_TESTNET_PRIVATE_KEY\s*=/i,
  /\b(seed phrase|mnemonic)\b/i,
];

/**
 * Defensive self-check: the serialized evidence must never contain secret
 * material. Structural patterns catch key markers; `forbidden` receives
 * exact strings that must not appear anywhere — the script passes the raw
 * private key and the serialized signed transaction. (Transaction hashes
 * are 32-byte hex like private keys, so key detection cannot use length
 * alone — the exact-value check is the precise guard.)
 */
export function assertEvidenceHasNoSecrets(text: string, forbidden: string[] = []): void {
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) {
      throw new Error('Evidence content failed the secret-safety check; nothing was written.');
    }
  }
  for (const value of forbidden) {
    if (value.length > 0 && text.includes(value)) {
      throw new Error(
        'Evidence content contains forbidden material (key or signed transaction); nothing was written.',
      );
    }
  }
}

export function buildEvidenceJson(data: EvidenceData): string {
  const payload = {
    note: 'Captured from actual RPC transaction and receipt. No private key material is included.',
    ...data,
  };
  const json = JSON.stringify(payload, null, 2) + '\n';
  assertEvidenceHasNoSecrets(json);
  return json;
}

export function buildEvidenceMarkdown(data: EvidenceData): string {
  const lines: string[] = [];
  lines.push('# Live Pharos Atlantic Testnet Transaction — Evidence');
  lines.push('');
  lines.push('> Real native PHRS transfer, broadcast via viem `sendTransaction` after');
  lines.push('> explicit `BROADCAST` confirmation. All values below are captured from the');
  lines.push('> actual RPC transaction (`eth_getTransactionByHash`) and receipt.');
  lines.push('> No private key material is included in this file.');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('|-------|-------|');
  lines.push(`| Timestamp (evidence captured) | ${data.timestampIso} |`);
  lines.push(`| Broadcast at | ${data.broadcastAtIso} |`);
  lines.push(`| Network | ${data.networkName} |`);
  lines.push(`| Chain ID | ${data.chainId} |`);
  lines.push(`| RPC endpoint | ${data.rpcUrl} |`);
  lines.push(`| Sender | \`${data.sender}\` |`);
  lines.push(`| Recipient | \`${data.recipient}\` |`);
  lines.push(`| Amount | ${data.amountWei} wei (${data.amountPhrs} PHRS) |`);
  lines.push(`| Transaction hash | \`${data.transactionHash}\` |`);
  lines.push(`| Block number | ${data.blockNumber ?? 'n/a'} |`);
  lines.push(`| Receipt status | ${data.receiptStatus} |`);
  lines.push(`| Gas used | ${data.gasUsed ?? 'n/a'} |`);
  lines.push(
    `| Effective gas price | ${data.effectiveGasPriceWei ?? 'n/a'} wei (${data.effectiveGasPriceWei !== null ? (BigInt(data.effectiveGasPriceWei) / 10n ** 9n).toString() : 'n/a'} gwei) |`,
  );
  lines.push(
    `| Actual fee | ${data.actualFeeWei ?? 'n/a'} wei (${data.actualFeePhrs ?? 'n/a'} PHRS) |`,
  );
  lines.push(
    `| Explorer URL | ${data.explorerUrl !== null ? data.explorerUrl : 'omitted — explorer could not be verified at capture time'} |`,
  );
  lines.push(`| Confirmations (at capture) | ${data.confirmations ?? 'not checked'} |`);
  if (data.preBroadcastSimulation !== null) {
    lines.push(
      `| Pre-broadcast simulation | status ${data.preBroadcastSimulation.status}, guard ${data.preBroadcastSimulation.guardDecision} |`,
    );
  }
  lines.push('');
  lines.push('Fee math: `actualFeeWei = gasUsed × effectiveGasPrice` (BigInt, exact).');
  lines.push(
    data.actualFeeWei !== null
      ? `Formatted: ${data.actualFeeWei} wei = ${formatPhrs(BigInt(data.actualFeeWei))} PHRS.`
      : 'Fee could not be derived from the receipt.',
  );
  lines.push('');
  return lines.join('\n');
}
