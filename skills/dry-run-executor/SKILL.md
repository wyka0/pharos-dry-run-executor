---
name: dry-run-executor
description: >
  Simulate an EVM transaction on Pharos Atlantic Testnet BEFORE sending it.
  Validates the transaction input, runs a read-only eth_call simulation,
  estimates gas and cost, predicts balance changes, decodes revert reasons,
  and returns a GO / NO_GO execution decision. Simulation-only: it never
  signs and never broadcasts a transaction, and it never needs a private key.
  Use when the user wants to "dry run a transaction", "simulate before
  sending", "check if a transaction will succeed", "estimate gas and cost",
  "preview transaction outcome", "predict balance changes", or asks for a
  safe pre-flight check on Pharos / PHRS / Atlantic testnet.
---

# Dry-Run Executor Skill

> Network Configuration: RPC URL, chain ID, and explorer URL are read from
> the project's `.env` (see `.env.example`). Defaults:
> `https://atlantic.dplabs-internal.com`, chain ID `688689`
> (Pharos Atlantic Testnet), native token PHRS.
>
> Private Key: NOT REQUIRED. This skill is simulation-only. It never signs
> and never broadcasts a transaction. Never pass a private key to this skill.

## When to Use This Skill

Use it whenever a transaction is about to be crafted for Pharos and someone
wants to know, without spending funds and without risking the chain state:

- "Will this transaction succeed?"
- "How much gas will this transaction use and what will it cost in PHRS?"
- "Why would this transaction revert?"
- "What will the sender/recipient balances look like afterwards?"
- "Give me a GO / NO_GO before we consider broadcasting (elsewhere)."

## What This Skill Does NOT Do

- It does NOT send, sign, or broadcast transactions (`eth_sendTransaction`,
  `eth_sendRawTransaction`, wallet signing are never called).
- It does NOT need or accept a private key.
- It does NOT guarantee that a future transaction will succeed. A passing
  simulation is a point-in-time prediction; network state changes.
- It never fabricates results. If the RPC endpoint is unreachable, it says so.

## Prerequisites

1. Node.js >= 20 and npm.
2. This repository checked out, with dependencies installed:

```bash
npm install
```

3. Optional: copy `.env.example` to `.env` to point at a different RPC.
   Defaults already target Pharos Atlantic Testnet.

## Capability Index

| User Need | Capability | Detailed Instructions |
|-----------|------------|----------------------|
| Simulate / dry-run a transaction before sending | `npm run dry-run -- --transaction <file>` | → references/simulation-guide.md#simulate-a-transaction-from-a-file |
| Check a built-in example (success / contract call / revert) | `npm run dry-run -- --example success\|contract\|failure` | → references/simulation-guide.md#run-a-built-in-example |
| Run the full reproducible demo | `npm run demo` | → references/simulation-guide.md#run-the-demo |
| Get a machine-readable result | add `--json` to any command | → references/simulation-guide.md#output-parsing |
| Understand GO / NO_GO and blocking reasons | read the report's EXECUTION GUARD section | → references/simulation-guide.md#execution-guard |
| Verify the RPC endpoint and chain ID | shown in every report (NETWORK section) | → references/simulation-guide.md#network-verification |
| Run the test suite (unit tests are offline) | `npm test`, optional `npm run test:live` | → references/simulation-guide.md#testing |

## How It Works (Pipeline)

1. **Transaction validation** — addresses, calldata hex, value format,
   required fields, and chain configuration are checked. Malformed
   transactions are rejected before any RPC call. Invalid inputs are never
   silently replaced with defaults.
2. **Network verification** — `eth_chainId` must return `688689` (or the
   configured chain ID) and the endpoint must be reachable, otherwise the
   run fails closed with a clear error. No results are fabricated.
3. **Simulation** — the transaction is executed via `eth_call` on the live
   RPC. Nothing is broadcast.
4. **Gas estimation** — `eth_estimateGas` + `eth_gasPrice`, then the cost is
   computed with BigInt-only arithmetic (`gasLimit × gasPrice` wei).
5. **Expected outcome** — for native PHRS transfers, sender/recipient
   balances are read via `eth_getBalance` and predicted after-values are
   shown, labeled `PREDICTED — NOT CONFIRMED`. For contract calls, the
   report states: `State changes not fully available from simulation`.
6. **Revert decoding** — `Error(string)` and `Panic(uint256)` are decoded.
   Anything else reports `Revert reason unavailable` plus the raw revert
   data. Reasons are never invented.
7. **Execution guard** — only a complete, successful simulation yields
   `GO`; anything else yields `NO_GO` with explicit blocking reasons.

## Safety Restrictions (always enforced)

1. Simulation-only: no `eth_send*`, no signing, no broadcasting — by design.
2. No private key is ever requested, accepted, or stored.
3. Even a `GO` decision must not trigger a broadcast.
   `GO means simulation passed. No transaction was sent.`
4. A `NO_GO` decision means: `NO_GO — execution blocked`.
5. Fixture inputs (loaded from files) are labeled `FIXTURE — NOT LIVE`.
6. Do not claim a simulated transaction is confirmed. It is not.

## Agent Guidelines

1. Confirm the project is installed (`npm install` has run).
2. Ask the user for (or construct) the transaction: `from`, `to`, `value`
   (wei string) or `valuePhrs` (decimal PHRS string), optional `data`
   (hex), optional `gasLimit`, optional `description`.
3. Write it to a JSON file and run:
   `npm run dry-run -- --transaction ./my-tx.json`
4. Read the report to the user: status, gas, cost, predicted balances or
   the contract-call note, revert reason (if any), and the guard decision.
5. On `NO_GO`, quote the blocking reasons verbatim and do not proceed to
   any broadcast step.
6. On `GO`, remind the user: simulation passed, no transaction was sent,
   and a fresh simulation should be run if the transaction is sent later.
