/**
 * send-testnet-transaction.ts — ONE real native PHRS transaction on the
 * Pharos Atlantic Testnet, gated by explicit typed confirmation.
 *
 * Submission method: the Atlantic testnet RPC does not support
 * `eth_sendTransaction` (it rejects it with "invalid method"). This script
 * therefore signs the transaction LOCALLY with viem (private-key account;
 * the key is read from the environment only, never printed or saved) and
 * submits the serialized bytes via `eth_sendRawTransaction`.
 * `eth_sendTransaction` is never called.
 *
 * ⚠️  THIS SCRIPT BROADCASTS A REAL TRANSACTION (unlike the rest of this
 * project, which is simulation-only). It never runs automatically: it is
 * not part of test, build, lint, or demo. It requires:
 *   - PHAROS_TESTNET_PRIVATE_KEY (environment variable only — never a file)
 *   - PHAROS_TESTNET_RECIPIENT   (explicit recipient — never assumed)
 *   - interactive confirmation: typing exactly  BROADCAST
 *
 * Hard safety rules enforced here:
 *   - chain is hard-locked to Pharos Atlantic Testnet (chain ID 688689);
 *     the RPC must report exactly 688689 before anything is sent
 *   - sender balance must cover amount + estimated fee
 *   - a pre-broadcast dry-run simulation (read-only) must pass with GO
 *   - exactly one transaction is sent per invocation
 *
 * Exit codes:
 *   0 — transaction broadcast and receipt confirmed as success
 *   1 — nothing was sent (validation failure, preflight failure,
 *       simulation refusal, or missing/incorrect confirmation)
 *   2 — transaction was broadcast but the receipt was not observed as
 *       successful (failed receipt or receipt timeout). The hash is always
 *       printed so it can be checked on the explorer.
 *
 * Evidence is written to evidence/ ONLY from actual RPC responses
 * (eth_getTransactionByHash + receipt). Nothing is fabricated.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { pharosAtlantic } from '../src/rpc/client.js';
import { runDryRun } from '../src/index.js';
import { loadLiveTxConfig, NETWORK_NAME } from '../src/live/config.js';
import { readConfirmation } from '../src/live/confirm.js';
import { runPreflight } from '../src/live/preflight.js';
import {
  assessPendingTransactions,
  signAndBroadcast,
  type SignedBroadcastResult,
} from '../src/live/broadcast.js';
import { summarizeReceipt } from '../src/live/receipt.js';
import {
  assertEvidenceHasNoSecrets,
  buildEvidenceJson,
  buildEvidenceMarkdown,
  type EvidenceData,
} from '../src/live/evidence.js';
import { formatPhrs } from '../src/simulation/calculate-cost.js';

const EXPLORER_BASE_URL = 'https://atlantic.pharosscan.xyz';
const RECEIPT_TIMEOUT_MS = 90_000;

function header(text: string): void {
  console.log('='.repeat(72));
  console.log(text);
  console.log('='.repeat(72));
}

/** Verifies the official explorer is reachable before linking it in evidence. */
async function verifyExplorerReachable(): Promise<boolean> {
  try {
    const res = await fetch(EXPLORER_BASE_URL, { signal: AbortSignal.timeout(8_000) });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function main(): Promise<number> {
  header('PHAROS ATLANTIC TESTNET — REAL TRANSACTION (1 native PHRS transfer)');
  console.log('This is NOT a simulation. Exactly ONE transaction will be sent,');
  console.log('and only after you type BROADCAST at the prompt.');
  console.log('');

  // ---- 1. Validate configuration (private key from env only) ----
  const loaded = loadLiveTxConfig(process.env);
  if (!loaded.ok) {
    header('CONFIGURATION INVALID — NOTHING WAS SENT');
    for (const e of loaded.errors) console.error(`- ${e}`);
    return 1;
  }
  const cfg = loaded.config;

  // Local account from the environment key (never printed, never saved).
  const account = privateKeyToAccount(
    process.env.PHAROS_TESTNET_PRIVATE_KEY!.trim() as `0x${string}`,
  );
  if (account.address.toLowerCase() !== cfg.sender.toLowerCase()) {
    // Defensive: loadLiveTxConfig derives the sender from the same key.
    console.error('SENDER DERIVATION MISMATCH — refusing to broadcast. Nothing was sent.');
    return 1;
  }

  // ---- 2. Read-only preflight against the RPC ----
  const publicClient = createPublicClient({
    chain: pharosAtlantic,
    transport: http(cfg.rpcUrl, { timeout: 15_000, retryCount: 0 }),
  });

  console.log('Running read-only preflight (chain ID, gas, balance)…');
  const pre = await runPreflight(publicClient, cfg.sender, cfg.recipient, cfg.amountWei);
  if (!pre.ok) {
    header('PREFLIGHT FAILED — NOTHING WAS SENT');
    for (const e of pre.errors) console.error(`- ${e}`);
    return 1;
  }

  // ---- 3. Duplicate-send guard: check for unmined sender transactions ----
  let nonceLatest: number;
  let noncePending: number | null;
  try {
    nonceLatest = await publicClient.getTransactionCount({ address: cfg.sender });
  } catch (err) {
    console.error(
      `Could not read sender nonce: ${err instanceof Error ? err.message : String(err)}`,
    );
    console.error('Nothing was sent.');
    return 1;
  }
  try {
    noncePending = await publicClient.getTransactionCount({
      address: cfg.sender,
      blockTag: 'pending',
    });
  } catch {
    noncePending = null; // checked again on any ambiguous failure below
  }
  const pendingCheck = assessPendingTransactions(nonceLatest, noncePending);
  if (pendingCheck.hasPending) {
    header('PENDING TRANSACTION DETECTED — NOTHING WAS SENT');
    console.error(pendingCheck.detail);
    return 1;
  }
  console.log(`Duplicate-send guard: ${pendingCheck.detail}`);

  // ---- 4. Pre-broadcast dry-run simulation (read-only safety check) ----
  console.log('Running pre-broadcast dry-run simulation (read-only eth_call)…');
  const dry = await runDryRun(
    {
      from: cfg.sender,
      to: cfg.recipient,
      value: cfg.amountWei.toString(),
      data: '0x',
      description: 'Pre-broadcast safety simulation for the live testnet transaction',
    },
    {
      config: {
        rpcUrl: cfg.rpcUrl,
        chainId: 688689,
        chainName: NETWORK_NAME,
      },
    },
  );
  if (dry.result.status !== 'SUCCESS' || dry.guard.decision !== 'GO') {
    header('PRE-BROADCAST SIMULATION DID NOT PASS — NOTHING WAS SENT');
    console.log(`simulation status: ${dry.result.status}, guard: ${dry.guard.decision}`);
    console.log(`reason: ${dry.guard.reason}`);
    for (const b of dry.guard.blockers) console.log(`- [${b.code}] ${b.detail}`);
    console.log('Resolve the issue (or re-run when the node is healthy) and try again.');
    return 1;
  }
  console.log(`Simulation: SUCCESS / GO (block ${dry.result.network.blockNumber?.toString() ?? 'n/a'}).`);
  console.log('');

  // ---- 5. Confirm-before-broadcast summary ----
  const broadcastAtIso = new Date().toISOString();
  header('TRANSACTION SUMMARY — REVIEW BEFORE CONFIRMING');
  console.log(`Network:        ${NETWORK_NAME}`);
  console.log(`Chain ID:       ${pre.chainId} (verified against RPC just now)`);
  console.log(`Sender:         ${cfg.sender}`);
  console.log(`Recipient:      ${cfg.recipient}`);
  console.log(`Amount:         ${cfg.amountWei.toString()} wei (${cfg.amountPhrs} PHRS)`);
  console.log(`Nonce:          ${nonceLatest}${noncePending !== null ? ` (pending: ${noncePending})` : ''}`);
  console.log(`Estimated gas:  ${pre.estimatedGas?.toString() ?? 'n/a'} gas units`);
  console.log(
    `Gas price:      ${pre.gasPriceWei?.toString() ?? 'n/a'} wei/gas ` +
      `(${pre.gasPriceWei !== null ? (pre.gasPriceWei / 10n ** 9n).toString() : 'n/a'} gwei)`,
  );
  console.log(
    `Estimated fee:  ${pre.estimatedFeeWei?.toString() ?? 'n/a'} wei ` +
      `(${pre.estimatedFeeWei !== null ? formatPhrs(pre.estimatedFeeWei) : 'n/a'} PHRS)`,
  );
  console.log(
    `Total debit:    ${pre.requiredWei?.toString() ?? 'n/a'} wei ` +
      `(amount + estimated fee; sender balance ${pre.senderBalanceWei?.toString() ?? 'n/a'} wei)`,
  );
  console.log('');
  console.log('Signing:    LOCAL (viem wallet client/account; private key never leaves this process)');
  console.log('Submission: eth_sendRawTransaction (signed locally; eth_sendTransaction is NOT used —');
  console.log('            this RPC rejects it with "invalid method")');
  console.log('');
  console.log(`This will send REAL testnet PHRS. Type ${'BROADCAST'} to confirm.`);
  const rl = createInterface({ input, output });
  const gate = await readConfirmation(() => rl.question('>>> '));
  rl.close();
  if (gate.decision !== 'CONFIRMED') {
    console.log(`\n${gate.reason}`);
    return 1;
  }

  // ---- 6. Sign locally and submit via eth_sendRawTransaction (exactly once) ----
  if (pre.estimatedGas === null || pre.gasPriceWei === null) {
    // Defensive: preflight ok implies both are known.
    console.error('Gas estimate unavailable after preflight — refusing to sign. Nothing was sent.');
    return 1;
  }

  let broadcast: SignedBroadcastResult;
  try {
    broadcast = await signAndBroadcast(
      account,
      cfg.rpcUrl,
      {
        to: cfg.recipient,
        value: cfg.amountWei,
        nonce: nonceLatest,
        gas: pre.estimatedGas,
        gasPrice: pre.gasPriceWei,
      },
      publicClient,
    );
  } catch (err) {
    // Ambiguous submission failure: NEVER retry automatically. Check for
    // pending/matching transactions first to avoid duplicate sends.
    header('SUBMISSION FAILED — NO AUTOMATIC RETRY');
    console.error(err instanceof Error ? err.message : String(err));
    let latestNow: number | null;
    let pendingNow: number | null;
    try {
      latestNow = await publicClient.getTransactionCount({ address: cfg.sender });
      pendingNow = await publicClient.getTransactionCount({
        address: cfg.sender,
        blockTag: 'pending',
      });
    } catch {
      latestNow = null;
      pendingNow = null;
    }
    const after = assessPendingTransactions(latestNow, pendingNow);
    if (after.hasPending) {
      console.error(`Possible duplicate risk: ${after.detail}`);
    } else {
      console.error(
        'No unmined sender transactions detected — the transaction was not accepted by the RPC.',
      );
    }
    console.error('Nothing was confirmed. No evidence was written. Re-run manually only after');
    console.error('verifying on the explorer that no matching transaction exists.');
    return 1;
  }
  const hash = broadcast.transactionHash;
  // SAFETY: broadcast.serialized is never logged and never written to evidence.

  console.log('');
  console.log(`Transaction submitted (eth_sendRawTransaction). Hash: ${hash}`);
  console.log('Waiting for the receipt…');

  // ---- 6. Wait for and verify the receipt ----
  let receipt: Awaited<ReturnType<typeof publicClient.waitForTransactionReceipt>>;
  try {
    receipt = await publicClient.waitForTransactionReceipt({
      hash,
      timeout: RECEIPT_TIMEOUT_MS,
    });
  } catch (err) {
    header('RECEIPT NOT OBSERVED WITHIN TIMEOUT');
    console.error(`Transaction hash: ${hash}`);
    // No automatic retry: check whether the transaction is known/pending first.
    let knownToChain: boolean;
    try {
      const probe = await publicClient.getTransaction({ hash });
      knownToChain = probe !== null;
    } catch {
      knownToChain = false;
    }
    try {
      const after = assessPendingTransactions(
        await publicClient.getTransactionCount({ address: cfg.sender }),
        await publicClient.getTransactionCount({ address: cfg.sender, blockTag: 'pending' }),
      );
      if (after.hasPending) {
        console.error(after.detail);
      }
    } catch {
      // nonce check unavailable — the hash above is the source of truth
    }
    console.error(
      knownToChain
        ? 'The transaction is known to the node and may still be mined. Do NOT re-send the same transaction.'
        : 'The transaction may still be mined. Check the explorer before re-attempting.',
    );
    console.error('No evidence file was written (no receipt was observed).');
    console.error(err instanceof Error ? err.message : String(err));
    return 2;
  }

  // Transaction + current block + post-broadcast chain context.
  let tx: Awaited<ReturnType<typeof publicClient.getTransaction>> | null;
  try {
    tx = await publicClient.getTransaction({ hash });
  } catch {
    tx = null; // recorded as unavailable in evidence — never fabricated
  }
  let currentBlock: bigint | null;
  let chainIdAfter: number | null;
  try {
    currentBlock = await publicClient.getBlockNumber();
    chainIdAfter = await publicClient.getChainId();
  } catch {
    currentBlock = null;
    chainIdAfter = null;
  }

  const summary = summarizeReceipt(
    {
      status: receipt.status ?? null,
      transactionHash: receipt.transactionHash ?? hash,
      blockNumber: receipt.blockNumber ?? null,
      gasUsed: receipt.gasUsed ?? null,
      effectiveGasPrice: receipt.effectiveGasPrice ?? null,
    },
    {
      from: tx?.from ?? null,
      to: tx?.to ?? null,
      value: tx?.value ?? null,
      chainId: tx?.chainId ?? null,
    },
    currentBlock,
  );

  const explorerVerified = await verifyExplorerReachable();

  // ---- 7. Evidence from actual RPC data ----
  const evidence: EvidenceData = {
    timestampIso: new Date().toISOString(),
    broadcastAtIso,
    networkName: NETWORK_NAME,
    chainId: chainIdAfter ?? pre.chainId ?? 688689,
    rpcUrl: cfg.rpcUrl,
    sender: summary.from ?? cfg.sender,
    recipient: summary.to ?? cfg.recipient,
    amountWei: cfg.amountWei.toString(),
    amountPhrs: cfg.amountPhrs,
    transactionHash: hash,
    blockNumber: summary.blockNumber?.toString() ?? null,
    receiptStatus: summary.receiptStatus,
    gasUsed: summary.gasUsed?.toString() ?? null,
    effectiveGasPriceWei: summary.effectiveGasPriceWei?.toString() ?? null,
    actualFeeWei: summary.actualFeeWei?.toString() ?? null,
    actualFeePhrs: summary.actualFeeWei !== null ? formatPhrs(summary.actualFeeWei) : null,
    explorerUrl: explorerVerified ? `${EXPLORER_BASE_URL}/tx/${hash}` : null,
    explorerVerified,
    confirmations: summary.confirmations?.toString() ?? null,
    preBroadcastSimulation: {
      status: dry.result.status,
      guardDecision: dry.guard.decision,
    },
  };

  mkdirSync('evidence', { recursive: true });
  const evidenceJson = buildEvidenceJson(evidence);
  const evidenceMd = buildEvidenceMarkdown(evidence);
  // Defensive final gate: evidence must never contain the key or signed bytes.
  assertEvidenceHasNoSecrets(evidenceJson, [
    process.env.PHAROS_TESTNET_PRIVATE_KEY!.trim(),
    broadcast.serialized,
  ]);
  assertEvidenceHasNoSecrets(evidenceMd, [
    process.env.PHAROS_TESTNET_PRIVATE_KEY!.trim(),
    broadcast.serialized,
  ]);
  writeFileSync('evidence/live-testnet-transaction.json', evidenceJson, 'utf8');
  writeFileSync('evidence/live-testnet-transaction.md', evidenceMd, 'utf8');

  // ---- 8. Report honestly ----
  const senderMatches = summary.from?.toLowerCase() === cfg.sender.toLowerCase();
  const recipientMatches = summary.to?.toLowerCase() === cfg.recipient.toLowerCase();
  const valueMatches = summary.valueWei === cfg.amountWei;
  const allVerified = summary.ok && senderMatches && recipientMatches && valueMatches;
  header(allVerified ? 'RECEIPT CONFIRMED — SUCCESS' : 'RECEIPT OBSERVED — VERIFICATION FAILED');
  console.log(`Transaction hash:     ${hash}`);
  console.log(`Block number:         ${summary.blockNumber?.toString() ?? 'n/a'}`);
  console.log(`Receipt status:       ${summary.receiptStatus}`);
  console.log(
    `Sender verified:      ${summary.from ?? 'n/a'} ` +
      `${senderMatches ? '✓ matches configured sender' : '✗ MISMATCH'}`,
  );
  console.log(
    `Recipient verified:   ${summary.to ?? 'n/a'} ` +
      `${recipientMatches ? '✓ matches configured recipient' : '✗ MISMATCH'}`,
  );
  console.log(
    `Value verified:       ${summary.valueWei?.toString() ?? 'n/a'} wei ` +
      `${valueMatches ? `✓ matches configured amount (${cfg.amountPhrs} PHRS)` : '✗ MISMATCH'}`,
  );
  console.log(`Gas used:             ${summary.gasUsed?.toString() ?? 'n/a'}`);
  console.log(
    `Effective gas price:  ${summary.effectiveGasPriceWei?.toString() ?? 'n/a'} wei/gas`,
  );
  console.log(
    `Actual fee:           ${summary.actualFeeWei?.toString() ?? 'n/a'} wei ` +
      `(${summary.actualFeeWei !== null ? formatPhrs(summary.actualFeeWei) : 'n/a'} PHRS)`,
  );
  console.log(
    `Chain context:        signed-tx chainId ${summary.txChainIdIsTestnet === null ? 'n/a' : summary.txChainIdIsTestnet ? '688689 (Pharos Atlantic Testnet) ✓' : 'NOT 688689 ✗'};` +
      ` post-broadcast RPC chainId ${chainIdAfter?.toString() ?? 'n/a'}`,
  );
  console.log(`Confirmations:        ${summary.confirmations?.toString() ?? 'not checked'}`);
  console.log(
    `Explorer:             ${evidence.explorerUrl ?? 'omitted — explorer could not be verified'}`,
  );
  console.log('Evidence written:');
  console.log('  evidence/live-testnet-transaction.json');
  console.log('  evidence/live-testnet-transaction.md');
  return allVerified ? 0 : 2;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error(`Unexpected error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    process.exitCode = 1;
  });
