# Dry-Run Executor

**Simulation-only transaction preview for the Pharos Atlantic Testnet.**

Dry-Run Executor takes a transaction request, validates it, simulates it
against the live Pharos Atlantic Testnet RPC **without broadcasting it**,
estimates gas and cost, predicts balance changes, decodes revert reasons,
and returns an explicit **GO / NO_GO** execution decision.

> **SAFETY FIRST — SIMULATION ONLY.**
> This project never signs, never broadcasts, and never needs a private key.
> Even a `GO` decision means only that the simulation passed:
> **no transaction was sent.** There is no code path that broadcasts.

## Purpose

Before a transaction is ever considered for sending, you want to know:

- Will it succeed, or will it revert?
- How much gas will it use, and what will it cost in PHRS?
- What will the sender and recipient balances look like afterwards?
- If it fails, *why*?

Dry-Run Executor answers those questions using real, read-only RPC calls
(`eth_call`, `eth_estimateGas`, `eth_getBalance`, `eth_gasPrice`,
`eth_chainId`, `eth_blockNumber`) against the Pharos Atlantic Testnet, and
enforces a fail-closed execution guard so an uncertain or failing
simulation can never produce a "safe to send" signal.

## Features

- **Strict input validation** — addresses, hex calldata, value formats,
  required fields. Malformed transactions are rejected before any RPC call
  and are never silently replaced with defaults.
- **Real simulation without broadcasting** — `eth_call` executes the
  transaction on live state; nothing is ever sent.
- **Typed simulation results** — `SUCCESS`, `REVERTED`, or `ERROR`, with
  gas estimates, wei/PHRS cost, fee assumptions, revert reasons, and raw
  error details.
- **Revert decoding** — decodes `Error(string)` and `Panic(uint256)`.
  Anything else reports `Revert reason unavailable` plus the raw revert
  data. Reasons are never invented.
- **Expected-outcome analysis** — predicted sender/recipient balances for
  native PHRS transfers (BigInt-only arithmetic), clearly labeled
  `PREDICTED — NOT CONFIRMED`. Contract calls state:
  `State changes not fully available from simulation`.
- **Automatic execution block** — a guard that only yields `GO` for a
  complete, successful simulation; everything else (revert, RPC error, gas
  estimation failure, validation failure, unverified network, insufficient
  funds, incomplete results) yields `NO_GO — execution blocked` with reasons.
- **Honest failure handling** — RPC outages and chain-ID mismatches fail
  closed with clear errors. No fabricated results, ever.
- **SkillEngine skill** — ships as an installable skill with a SKILL.md
  entry point and a detailed simulation guide.
- **Offline-capable test suite** — 74 unit tests with mocked RPC, plus 3
  optional live tests (disabled by default).

## Architecture

```text
dry-run-executor/
├── src/
│   ├── index.ts                    # public API + full pipeline (runDryRun)
│   ├── cli.ts                      # CLI (--help/--example/--transaction/--demo/--json)
│   ├── config.ts                   # .env + env-var config, validated
│   ├── types.ts                    # all shared types (bigint wei everywhere)
│   ├── validation/transaction.ts   # strict transaction input validation
│   ├── rpc/
│   │   ├── client.ts               # read-only viem client + chain verification
│   │   └── errors.ts               # RPC vs execution error classification
│   ├── simulation/
│   │   ├── simulate.ts             # eth_call simulation (never broadcasts)
│   │   ├── estimate-gas.ts         # eth_estimateGas + eth_gasPrice
│   │   ├── decode-revert.ts        # Error(string) / Panic(uint256) decoding
│   │   └── calculate-cost.ts       # BigInt wei math, PHRS/gwei formatting
│   ├── analysis/
│   │   ├── balance-diff.ts         # predicted balances / contract-call note
│   │   └── report.ts               # text + JSON report rendering
│   └── execution/
│       └── execution-guard.ts      # GO / NO_GO decision (pure, never executes)
├── skills/dry-run-executor/        # SkillEngine skill (SKILL.md + references)
├── tests/                          # Vitest suite (offline + optional live)
├── examples/                       # transaction fixtures for the CLI
└── docs/                           # flow diagram + captured demo output
```

Pipeline: **validate → verify network → simulate (`eth_call`) → estimate
gas → expected-outcome analysis → execution guard → GO / NO_GO**.
See `docs/flow-diagram.md` for the full diagram and the exact RPC methods
used (and the ones deliberately never used).

## Requirements

- Node.js >= 20
- npm
- Network access to the Pharos Atlantic Testnet RPC (for simulations only)

## Installation

```bash
git clone <your-fork-url> dry-run-executor
cd dry-run-executor
npm install
```

## Configuration

Copy the example environment file and adjust if needed:

```bash
cp .env.example .env
```

| Variable | Default | Purpose |
|----------|---------|---------|
| `PHAROS_RPC_URL` | `https://atlantic.dplabs-internal.com` | Read-only JSON-RPC endpoint |
| `PHAROS_CHAIN_ID` | `688689` | Expected chain ID (verified against the RPC before simulating) |
| `PHAROS_CHAIN_NAME` | `Pharos Atlantic Testnet` | Shown in reports |
| `PHAROS_EXPLORER_URL` | `https://atlantic.pharosscan.xyz` | Shown in reports only |

Network facts: Pharos Atlantic Testnet, chain ID `688689`
(`0xa8231`), native token **PHRS** (18 decimals). The executor verifies the
RPC-reported chain ID against the configured value before simulating and
fails closed on mismatch.

**No private key is needed or read. Never put a private key in `.env`.**

## CLI usage

```bash
# Help
npm run dry-run -- --help

# Built-in examples (inputs fixed, simulation is LIVE RPC)
npm run dry-run -- --example success    # native transfer  → expects GO
npm run dry-run -- --example contract   # WPHRS.symbol()   → expects GO
npm run dry-run -- --example failure    # USDC transfer from a 0-balance address → NO_GO

# Simulate your own transaction (input from file = FIXTURE — NOT LIVE)
npm run dry-run -- --transaction ./examples/successful-simulation.json
npm run dry-run -- --transaction ./my-tx.json --json

# Machine-readable output
npm run dry-run -- --example success --json
```

Exit codes: `0` = GO (or demo completed), `1` = NO_GO (execution blocked),
`2` = usage error / unreadable input / RPC unavailable (nothing fabricated).

Transaction input format (JSON file):

```json
{
  "from": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  "to": "0x000000000000000000000000000000000000dEaD",
  "value": "1000000000000000",
  "data": "0x",
  "description": "optional human description"
}
```

- `value` is a wei string (decimal or `0x`-hex); alternatively use
  `valuePhrs` ("0.001") — never numbers, to avoid float precision loss.
- `data` is optional `0x`-prefixed even-length hex calldata.
- `gasLimit` (optional, string) is used as-is when provided.

## Skill installation

The project ships as a Pharos Skill Engine-compatible skill
(`skills/dry-run-executor/SKILL.md`, per the official Pharos Skill Engine
structure of an SKILL.md entry point plus `references/`). The skill calls
the real implementation — every command in it runs the actual CLI.

After pushing this repository to GitHub, install the skill with the
standard skills CLI (the same mechanism used by the official
`pharosnetwork/pharos-skill-engine`):

```bash
npx skills add https://github.com/<your-username>/dry-run-executor --skill dry-run-executor
```

For local development, point an agent directly at the skill entry point:

```text
skills/dry-run-executor/SKILL.md
```

See the official Pharos Skill Engine guide for the skill format:
<https://docs.pharos.xyz/tooling-and-infrastructure/pharos-skill-engine-guide>

## Demo instructions

```bash
npm run demo
```

Runs three reproducible demonstrations against the live RPC and prints
full reports:

1. **Successful native transfer** — 0.001 PHRS from a funded address to
   `0xdEaD` → `SUCCESS`, exact predicted balances, `GO`.
2. **Successful contract call** — `WPHRS.symbol()` read → `SUCCESS` with
   return data, `State changes not fully available from simulation`, `GO`.
3. **Failing simulation** — `USDC.transfer` from an address holding 0 USDC
   → `REVERTED`, `Revert reason unavailable` + raw revert data, `NO_GO —
   execution blocked`.

A captured, dated example run is in `docs/demo.md`. Example inputs are
fixed (labeled `FIXTURE — NOT LIVE` when loaded from files); the
simulations themselves are live RPC. No transaction is ever broadcast.

## Testing

```bash
npm test          # 74 offline unit tests (mocked RPC) — no network needed
npm run test:live # additionally runs 3 live read-only tests (disabled by default)
npm run typecheck # tsc --noEmit
npm run lint      # eslint
npm run build     # tsc -> dist/
```

Unit tests mock the RPC client entirely and cover: valid/invalid inputs,
successful simulation, revert handling, revert decoding, gas estimation,
cost math (BigInt exactness), predicted balance differences, RPC failures,
the execution guard, and the simulation-only guarantee (no broadcast
method exists or is ever called). Live tests only perform read-only calls.

## Safety limitations

- **Simulation only.** Nothing here can send a transaction. The only RPC
  methods used are `eth_chainId`, `eth_blockNumber`, `eth_getBalance`,
  `eth_gasPrice`, `eth_call`, `eth_estimateGas`.
- **A passing simulation is not a guarantee.** It reflects the chain state
  at the simulation block. State changes; later execution can still fail
  for new reasons (gas price moves, front-running, node differences).
- **`eth_call` may not enforce everything.** Some nodes (including this
  Pharos RPC) skip sender-balance checks inside `eth_call`; the outcome
  analysis re-checks affordability and the guard blocks on
  `INSUFFICIENT_PREDICTED_FUNDS`.
- **Revert decoding is limited by design.** Only `Error(string)` and
  `Panic(uint256)` are decoded; custom errors and empty revert data are
  reported as `Revert reason unavailable` with the raw hex. Reasons are
  never invented.
- **Infrastructure errors can look like reverts on the wire.** A
  load-balanced RPC occasionally returns `execution reverted` with empty
  data for calls that would succeed. The guard fails closed (`NO_GO`);
  re-run against a fresh block when in doubt.
- **State changes for contract calls are not derivable** from `eth_call`
  alone; the report says so explicitly.
- **No mainnet, no real funds.** The default target is a testnet. Do not
  treat any output as financial advice.

## License

MIT
