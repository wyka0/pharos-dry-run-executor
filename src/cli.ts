/**
 * Dry-Run Executor CLI.
 *
 * Commands:
 *   npm run dry-run -- --help
 *   npm run dry-run -- --example success
 *   npm run dry-run -- --example contract
 *   npm run dry-run -- --example failure
 *   npm run dry-run -- --transaction ./examples/successful-simulation.json
 *   npm run dry-run -- --transaction ./tx.json --json
 *   npm run demo
 *
 * SAFETY: this CLI only ever performs read-only RPC calls (eth_chainId,
 * eth_blockNumber, eth_getBalance, eth_gasPrice, eth_call, eth_estimateGas).
 * It never signs and never broadcasts a transaction. Even a GO decision
 * means only that the simulation passed: no transaction was sent.
 */

import { readFileSync } from 'node:fs';
import { initConfig } from './config.js';
import { runDryRun } from './index.js';
import { renderJson, renderReport } from './analysis/report.js';
import type { DryRunReport, RawTransactionRequest } from './types.js';

const USAGE = `
Dry-Run Executor — simulation-only transaction preview for Pharos Atlantic Testnet
SAFETY: no private key is ever used; no transaction is ever broadcast.

Usage:
  npm run dry-run -- --help
  npm run dry-run -- --example success|contract|failure
  npm run dry-run -- --transaction <path-to-json>
  npm run dry-run -- --transaction <path-to-json> --json
  npm run demo

Options:
  --help                Show this help.
  --example <name>      Run a built-in example transaction:
                          success  — native PHRS transfer (expects GO)
                          contract — WPHRS.symbol() contract call (expects GO)
                          failure  — USDC transfer with zero balance (expects NO_GO)
  --transaction <path>  Load a transaction request from a JSON file.
                        The input is labeled "FIXTURE — NOT LIVE"; the
                        simulation itself runs against the live RPC.
  --json                Print a machine-readable JSON report.
  --rpc-url <url>       Override PHAROS_RPC_URL for this run.

Exit codes:
  0  report produced with a GO decision (or demo completed)
  1  report produced with a NO_GO decision (execution blocked)
  2  usage error, unreadable input, or RPC endpoint unavailable —
     in that case NO simulation result is shown and nothing is fabricated.

GO means simulation passed. No transaction was sent.
`.trim();

interface BuiltInExample {
  name: string;
  expected: 'GO' | 'NO_GO';
  tx: RawTransactionRequest;
}

/** Built-in examples. Inputs are fixed; simulations run live. */
const EXAMPLES: Record<string, BuiltInExample> = {
  success: {
    name: 'success',
    expected: 'GO',
    tx: {
      description:
        'Native PHRS transfer of 0.001 PHRS from a funded testnet address to the 0xdEaD address',
      from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      to: '0x000000000000000000000000000000000000dEaD',
      value: '1000000000000000',
      data: '0x',
    },
  },
  contract: {
    name: 'contract',
    expected: 'GO',
    tx: {
      description: 'Read-only contract call: WPHRS.symbol() on Pharos Atlantic Testnet',
      from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      to: '0x838800b758277CC111B2d48Ab01e5E164f8E9471',
      value: '0',
      data: '0x95d89b41',
    },
  },
  failure: {
    name: 'failure',
    expected: 'NO_GO',
    tx: {
      description:
        'USDC transfer of 1 USDC from an address holding 0 USDC — deterministic revert',
      from: '0x1111111111111111111111111111111111111111',
      to: '0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8',
      value: '0',
      data: '0xa9059cbb000000000000000000000000000000000000000000000000000000000000dead00000000000000000000000000000000000000000000000000000000000f4240',
    },
  },
};

const LABEL_FIXTURE = 'FIXTURE — NOT LIVE (input loaded from file; simulation below runs against live RPC)';
const LABEL_BUILT_IN = 'BUILT-IN EXAMPLE (input is fixed; simulation below runs against live RPC)';

interface CliArgs {
  mode: 'help' | 'example' | 'transaction' | 'demo';
  example?: string;
  transactionPath?: string;
  json: boolean;
  rpcUrl?: string;
  error?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { mode: 'help', json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--help':
      case '-h':
        return { mode: 'help', json: false };
      case '--demo':
        return { mode: 'demo', json: false };
      case '--json':
        args.json = true;
        break;
      case '--example': {
        i += 1;
        const name = argv[i];
        if (name === undefined || !(name in EXAMPLES)) {
          return {
            mode: 'help',
            json: false,
            error: `Unknown example "${name ?? ''}". Valid: success, contract, failure.`,
          };
        }
        args.mode = 'example';
        args.example = name;
        break;
      }
      case '--transaction': {
        i += 1;
        const p = argv[i];
        if (p === undefined || p.length === 0) {
          return { mode: 'help', json: false, error: '--transaction requires a file path.' };
        }
        args.mode = 'transaction';
        args.transactionPath = p;
        break;
      }
      case '--rpc-url': {
        i += 1;
        const url = argv[i];
        if (url === undefined || url.length === 0) {
          return { mode: 'help', json: false, error: '--rpc-url requires a URL.' };
        }
        args.rpcUrl = url;
        break;
      }
      default:
        return { mode: 'help', json: false, error: `Unknown argument "${arg ?? ''}".` };
    }
  }
  return args;
}

function loadTransactionFile(path: string): { ok: true; tx: RawTransactionRequest } | { ok: false; error: string } {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    return { ok: false, error: `Cannot read transaction file "${path}": ${err instanceof Error ? err.message : String(err)}` };
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: `Transaction file "${path}" must contain a JSON object.` };
    }
    return { ok: true, tx: parsed as RawTransactionRequest };
  } catch (err) {
    return { ok: false, error: `Transaction file "${path}" is not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function printReport(report: DryRunReport, label: string, json: boolean): void {
  if (json) {
    console.log(renderJson(report, { inputSourceLabel: label }));
  } else {
    console.log(renderReport(report, { inputSourceLabel: label }));
  }
}

async function runSingle(
  tx: RawTransactionRequest,
  label: string,
  json: boolean,
  rpcUrl?: string,
): Promise<number> {
  const report = await runDryRun(tx, {
    ...(rpcUrl !== undefined
      ? { config: { ...initConfig(), rpcUrl } }
      : {}),
  });
  printReport(report, label, json);
  if (report.guard.decision === 'GO') {
    console.log('GO means simulation passed. No transaction was sent.');
    return 0;
  }
  console.log('NO_GO — execution blocked');
  return 1;
}

async function runDemo(json: boolean): Promise<number> {
  console.log('DEMO 1/3 — successful native transfer simulation (expects GO)');
  console.log('='.repeat(72));
  const exit1 = await runSingle(EXAMPLES.success!.tx, LABEL_BUILT_IN, json);
  console.log();
  console.log('DEMO 2/3 — successful contract call simulation (expects GO)');
  console.log('='.repeat(72));
  const exit2 = await runSingle(EXAMPLES.contract!.tx, LABEL_BUILT_IN, json);
  console.log();
  console.log('DEMO 3/3 — failing simulation (expects NO_GO and execution blocked)');
  console.log('='.repeat(72));
  const exit3 = await runSingle(EXAMPLES.failure!.tx, LABEL_BUILT_IN, json);
  console.log();
  console.log('='.repeat(72));
  console.log(
    `Demo finished. Decisions: success=${exit1 === 0 ? 'GO' : 'NO_GO'}, ` +
      `contract=${exit2 === 0 ? 'GO' : 'NO_GO'}, failure=${exit3 === 0 ? 'GO' : 'NO_GO (expected)'}.`,
  );
  console.log('GO means simulation passed. No transaction was sent. NO_GO — execution blocked.');
  console.log('All results above are LIVE read-only simulations against Pharos Atlantic Testnet RPC.');
  console.log('No transaction was broadcast at any point.');
  // A NO_GO on the failure example is the expected outcome, so the demo
  // itself succeeds as long as all three reports were produced.
  return 0;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (args.error !== undefined) {
    console.error(`Error: ${args.error}\n`);
    console.error(USAGE);
    return 2;
  }
  if (args.mode === 'help') {
    console.log(USAGE);
    return 0;
  }

  try {
    initConfig(); // validates .env / environment early, fails fast
  } catch (err) {
    console.error(`Configuration error: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }

  if (args.mode === 'demo') {
    try {
      return await runDemo(args.json);
    } catch (err) {
      console.error(
        `RPC infrastructure error during demo: ${err instanceof Error ? err.message : String(err)}`,
      );
      console.error('No simulation results are shown; nothing was fabricated.');
      return 2;
    }
  }

  if (args.mode === 'example') {
    const example = EXAMPLES[args.example!];
    if (example === undefined) {
      console.error(`Error: unknown example "${args.example}".`);
      return 2;
    }
    try {
      return await runSingle(example.tx, LABEL_BUILT_IN, args.json, args.rpcUrl);
    } catch (err) {
      console.error(
        `RPC infrastructure error: ${err instanceof Error ? err.message : String(err)}`,
      );
      console.error('No simulation results are shown; nothing was fabricated.');
      return 2;
    }
  }

  // --transaction <path>
  const loaded = loadTransactionFile(args.transactionPath!);
  if (!loaded.ok) {
    console.error(`Error: ${loaded.error}`);
    return 2;
  }
  try {
    return await runSingle(loaded.tx, LABEL_FIXTURE, args.json, args.rpcUrl);
  } catch (err) {
    console.error(
      `RPC infrastructure error: ${err instanceof Error ? err.message : String(err)}`,
    );
    console.error('No simulation results are shown; nothing was fabricated.');
    return 2;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error(`Unexpected error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    process.exitCode = 2;
  });
