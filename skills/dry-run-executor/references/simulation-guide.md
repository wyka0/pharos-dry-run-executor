# Dry-Run Executor — Simulation Operation Guide

> Network Configuration: RPC URL / chain ID are read from `.env`
> (`PHAROS_RPC_URL`, `PHAROS_CHAIN_ID`). Defaults:
> `https://atlantic.dplabs-internal.com`, chain ID `688689`, Pharos Atlantic
> Testnet, native token PHRS (18 decimals).
>
> Private Key: NOT REQUIRED — this skill never signs or broadcasts.

Every command below is read-only. Only these JSON-RPC methods are ever used:
`eth_chainId`, `eth_blockNumber`, `eth_getBalance`, `eth_gasPrice`,
`eth_call`, `eth_estimateGas`.

---

## Transaction Input Format

A transaction request is a JSON object:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `from` | string | Yes | Sender address, `0x` + 40 hex chars. Used only as the `from` of `eth_call` / `eth_estimateGas`. |
| `to` | string | Yes | Recipient or contract address, `0x` + 40 hex chars. |
| `value` | string | Yes* | Value in wei: decimal string (`"1000000000000000"`) or `0x`-hex string. Numbers are rejected to avoid float precision loss. |
| `valuePhrs` | string | Yes* | Alternative to `value`: exact decimal PHRS string (`"0.001"`), max 18 decimals. |
| `data` | string | No | Calldata as `0x`-prefixed even-length hex. Empty/missing = native transfer. |
| `gasLimit` | string | No | Gas units as decimal or `0x`-hex string. When omitted, estimated via `eth_estimateGas`. |
| `description` | string | No | Free-text description shown in the report. |

\* Exactly one of `value` / `valuePhrs` must be present.

Validation is strict. Rejected inputs (invalid address, odd-length calldata,
non-hex value, missing fields, zero `gasLimit`, both `value` and
`valuePhrs`) produce `status: ERROR` with `failureKind: VALIDATION` and
`NO_GO`. Invalid inputs are never silently replaced with defaults.

---

## Simulate a Transaction from a File

### Command Template

```bash
npm run dry-run -- --transaction ./examples/successful-simulation.json
npm run dry-run -- --transaction ./my-tx.json --json
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `--transaction <path>` | path | Yes | JSON file with the transaction request (see format above). |
| `--json` | flag | No | Print a machine-readable JSON report instead of text. |

### Output Parsing

The text report contains these sections, in order:

| Section | Fields | How to interpret |
|---------|--------|------------------|
| INPUT TRANSACTION | source, from, to, value, data, gasLimit | `source` is `FIXTURE — NOT LIVE` for file inputs; the simulation below it is live RPC. |
| NETWORK | chain, rpc, block, verified | `verified: yes` is required for a meaningful result. |
| SIMULATION | status, returnData / revert | `SUCCESS` / `REVERTED` / `ERROR`. |
| GAS | gasLimit, gasPrice, gasCost, assumption | Cost = gasLimit × gasPrice (wei), also in PHRS. |
| EXPECTED OUTCOME | predicted balances or contract-call note | Labeled `PREDICTED — NOT CONFIRMED`; contract calls say `State changes not fully available from simulation`. |
| EXECUTION GUARD | decision, reason, blockers | `GO` or `NO_GO` with reasons. |

### Error Handling

| Error Signature | Cause | Suggested Action |
|-----------------|-------|------------------|
| `RPC endpoint unreachable` | Node down / network down / DNS failure | Check `PHAROS_RPC_URL`; no results are fabricated. |
| `RPC chain ID mismatch` | Endpoint is not Pharos Atlantic Testnet | Point `PHAROS_RPC_URL` at the right chain. |
| `failureKind: VALIDATION` | Malformed input | Fix the JSON per the input format table. |
| `failureKind: GAS_ESTIMATION` | `eth_estimateGas` reverted | The transaction is unlikely to execute; check logic/value. |
| `status: REVERTED` | On-chain simulation reverted | Read `revert:` line; `Revert reason unavailable` + raw data means a custom/empty revert. |

> **Agent Guidelines**:
> 1. Never edit the transaction file to "make it pass".
> 2. Report `NO_GO` verbatim; do not proceed toward broadcasting.
> 3. Exit codes: 0 = GO, 1 = NO_GO, 2 = usage/infrastructure error.

---

## Run a Built-in Example

### Command Template

```bash
npm run dry-run -- --example success
npm run dry-run -- --example contract
npm run dry-run -- --example failure
```

### Parameters

| Example | What it does | Expected decision |
|---------|--------------|-------------------|
| `success` | Native transfer of 0.001 PHRS from a funded address to `0xdEaD` | `GO` |
| `contract` | Read-only contract call `WPHRS.symbol()` (WPHRS = `0x838800b758277CC111B2d48Ab01e5E164f8E9471`) | `GO` |
| `failure` | `USDC.transfer` of 1 USDC (`0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8`) from an address holding 0 USDC — deterministic revert | `NO_GO` |

These examples run LIVE simulations against the RPC (inputs are fixed).

---

## Run the Demo

### Command Template

```bash
npm run demo
```

Runs all three examples (success, contract, failure) sequentially with
full reports and exits 0 when all three reports were produced (the
`failure` example's `NO_GO` is the expected outcome).

---

## Network Verification

Every run first calls `eth_chainId` (and `eth_blockNumber`). If the endpoint
does not answer or reports a chain ID other than the configured one, the
result is `status: ERROR`, `failureKind: RPC`, `NO_GO` — and no simulation
data is shown. Never fabricate results when this happens.

---

## Execution Guard

GO is granted only when ALL of the following hold:

1. Input validated.
2. RPC reachable and chain ID matches.
3. Simulation status is `SUCCESS`.
4. Gas estimate and cost computed.
5. Outcome analysis complete (for native transfers: balances read and the
   sender can afford value + gas — some nodes do not enforce balances inside
   `eth_call`, so the guard re-checks what the node does not).

Anything else yields `NO_GO` with one or more blockers:

| Blocker code | Meaning |
|--------------|---------|
| `SIMULATION_REVERTED` | The simulated transaction reverts. |
| `SIMULATION_ERROR_RPC` | RPC unavailable — simulation not performed. |
| `SIMULATION_ERROR_GAS_ESTIMATION` | Gas estimation failed. |
| `SIMULATION_ERROR_VALIDATION` | Input failed validation. |
| `SIMULATION_ERROR_UNKNOWN` | Unclassified simulation error. |
| `NETWORK_NOT_VERIFIED` | Chain ID mismatch or endpoint unreachable. |
| `MISSING_GAS_ESTIMATE` | No gas estimate; cost cannot be bounded. |
| `INSUFFICIENT_PREDICTED_FUNDS` | Sender cannot cover value + estimated gas. |
| `INCOMPLETE_RESULT` | Result incomplete/uncertain — fails closed. |

`GO means simulation passed. No transaction was sent.`
`NO_GO — execution blocked`

---

## Testing

```bash
npm test          # 74 offline unit tests (fake RPC) + 3 skipped live tests
npm run test:live # also runs the 3 live read-only RPC tests
npm run typecheck
npm run lint
npm run build
```

Unit tests never touch the network. Live tests are read-only and disabled
by default.
