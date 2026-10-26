# Dry-Run Executor — Demo

> All output below was captured from a real run of `npm run demo` against
> the live Pharos Atlantic Testnet RPC (`https://atlantic.dplabs-internal.com`,
> chain ID 688689). Every result is a **read-only simulation** — no
> transaction was ever broadcast, and no private key was ever used.
>
> Inputs are fixed example transactions; the simulations are LIVE RPC calls.
> Nothing in this document is fabricated.

- **Captured:** 2026-10-26
- **Command:** `npm run demo`
- **Outcome:** `success=GO, contract=GO, failure=NO_GO (expected)`
- **Blocks observed:** 31894117–31894118
- **Exit code:** 0

## What the demo covers

| # | Example | Transaction | Expected |
|---|---------|-------------|----------|
| 1 | success | Native transfer of 0.001 PHRS from a funded address to `0xdEaD` | GO |
| 2 | contract | Read-only contract call `WPHRS.symbol()` (WPHRS `0x838800b758277CC111B2d48Ab01e5E164f8E9471`) | GO |
| 3 | failure | `USDC.transfer` of 1 USDC from an address holding 0 USDC — deterministic revert | NO_GO, execution blocked |

## Reproduce

```bash
npm install
npm run demo
# or individually:
npm run dry-run -- --example success
npm run dry-run -- --example contract
npm run dry-run -- --example failure
```

## Full captured output

```text

> dry-run-executor@1.0.0 demo
> tsx src/cli.ts --demo

DEMO 1/3 — successful native transfer simulation (expects GO)
========================================================================
════════════════════════════════════════════════════════════════════════
DRY-RUN EXECUTOR — TRANSACTION SIMULATION REPORT
SIMULATION ONLY — NO TRANSACTION IS EVER SENT OR BROADCAST
════════════════════════════════════════════════════════════════════════
INPUT TRANSACTION
  source:      BUILT-IN EXAMPLE (input is fixed; simulation below runs against live RPC)
  description: Native PHRS transfer of 0.001 PHRS from a funded testnet address to the 0xdEaD address
  from:        0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
  to:          0x000000000000000000000000000000000000dEaD
  value:       1000000000000000 wei (0.001000000000000000 PHRS)
  data:        (empty — native transfer)
  gasLimit:    (not specified — will estimate)

NETWORK (live read-only RPC)
  chain:       688689 — Pharos Atlantic Testnet
  rpc:         https://atlantic.dplabs-internal.com
  explorer:    https://atlantic.pharosscan.xyz
  block:       31894117
  verified:    yes

SIMULATION (eth_call — read-only, nothing broadcast)
  status:      SUCCESS
  returnData:  (empty)

GAS
  gasLimit:    21000 gas units
  gasPrice:    10000000000 wei/gas (10.000000000 gwei)
  gasCost:     210000000000000 wei (0.000210000000000000 PHRS)
  assumption:  eth_estimateGas + eth_gasPrice — Flat gas price from eth_gasPrice. Actual fee depends on the gas price at mining time; EIP-1559 priority fees, if any, are not modeled. This is an estimate, not a quote.

EXPECTED OUTCOME (PREDICTED — NOT CONFIRMED)
  sender balance before:    277943753174938036 wei (0.277943753174938036 PHRS)
  sender balance after:     276733753174938036 wei (0.276733753174938036 PHRS)  [PREDICTED — NOT CONFIRMED]
  recipient balance before: 3762145791673329147 wei (3.762145791673329147 PHRS)
  recipient balance after:  3763145791673329147 wei (3.763145791673329147 PHRS)  [PREDICTED — NOT CONFIRMED]
  value transferred:        1000000000000000 wei
  estimated gas cost:       210000000000000 wei

EXECUTION GUARD (simulation-only)
  decision:    GO
  reason:      Simulation succeeded on-chain state as of the simulation block; gas and cost estimated; no blocking condition found.
  GO means simulation passed. No transaction was sent.

DISCLAIMER: A passing simulation is a point-in-time prediction, not a guarantee. Network state changes between simulation and any future execution. This tool never sends transactions.
════════════════════════════════════════════════════════════════════════
GO means simulation passed. No transaction was sent.

DEMO 2/3 — successful contract call simulation (expects GO)
========================================================================
════════════════════════════════════════════════════════════════════════
DRY-RUN EXECUTOR — TRANSACTION SIMULATION REPORT
SIMULATION ONLY — NO TRANSACTION IS EVER SENT OR BROADCAST
════════════════════════════════════════════════════════════════════════
INPUT TRANSACTION
  source:      BUILT-IN EXAMPLE (input is fixed; simulation below runs against live RPC)
  description: Read-only contract call: WPHRS.symbol() on Pharos Atlantic Testnet
  from:        0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
  to:          0x838800b758277CC111B2d48Ab01e5E164f8E9471
  value:       0 wei (0.000000000000000000 PHRS)
  data:        0x95d89b41
  gasLimit:    (not specified — will estimate)

NETWORK (live read-only RPC)
  chain:       688689 — Pharos Atlantic Testnet
  rpc:         https://atlantic.dplabs-internal.com
  explorer:    https://atlantic.pharosscan.xyz
  block:       31894118
  verified:    yes

SIMULATION (eth_call — read-only, nothing broadcast)
  status:      SUCCESS
  returnData:  0x000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000055750485253000000000000000000000000000000000000000000000000000000

GAS
  gasLimit:    32575 gas units
  gasPrice:    10000000000 wei/gas (10.000000000 gwei)
  gasCost:     325750000000000 wei (0.000325750000000000 PHRS)
  assumption:  eth_estimateGas + eth_gasPrice — Flat gas price from eth_gasPrice. Actual fee depends on the gas price at mining time; EIP-1559 priority fees, if any, are not modeled. This is an estimate, not a quote.

EXPECTED OUTCOME (contract call)
  target:      0x838800b758277CC111B2d48Ab01e5E164f8E9471
  calldata:    0x95d89b41
  State changes not fully available from simulation

EXECUTION GUARD (simulation-only)
  decision:    GO
  reason:      Simulation succeeded on-chain state as of the simulation block; gas and cost estimated; no blocking condition found.
  GO means simulation passed. No transaction was sent.

DISCLAIMER: A passing simulation is a point-in-time prediction, not a guarantee. Network state changes between simulation and any future execution. This tool never sends transactions.
════════════════════════════════════════════════════════════════════════
GO means simulation passed. No transaction was sent.

DEMO 3/3 — failing simulation (expects NO_GO and execution blocked)
========================================================================
════════════════════════════════════════════════════════════════════════
DRY-RUN EXECUTOR — TRANSACTION SIMULATION REPORT
SIMULATION ONLY — NO TRANSACTION IS EVER SENT OR BROADCAST
════════════════════════════════════════════════════════════════════════
INPUT TRANSACTION
  source:      BUILT-IN EXAMPLE (input is fixed; simulation below runs against live RPC)
  description: USDC transfer of 1 USDC from an address holding 0 USDC — deterministic revert
  from:        0x1111111111111111111111111111111111111111
  to:          0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8
  value:       0 wei (0.000000000000000000 PHRS)
  data:        0xa9059cbb000000000000000000000000000000000000000000000000000000000000dead00000000000000000000000000000000000000000000000000000000000f4240
  gasLimit:    (not specified — will estimate)

NETWORK (live read-only RPC)
  chain:       688689 — Pharos Atlantic Testnet
  rpc:         https://atlantic.dplabs-internal.com
  explorer:    https://atlantic.pharosscan.xyz
  block:       31894118
  verified:    yes

SIMULATION (eth_call — read-only, nothing broadcast)
  status:      REVERTED
  revert:      Revert reason unavailable (raw revert data: 0xe450d38c0000000000000000000000001111111111111111111111111111111111111111000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f4240)
  decoded as:  UNDECODABLE
  warning:     Expected-state analysis skipped: the transaction reverts.

GAS
  estimate:    UNAVAILABLE — Gas estimation failed: the transaction is unlikely to execute (Execution reverted for an unknown reason. Estimate Gas Arguments: from: 0x1111111111111111111111111111111111111111 to: 0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8 value: 0 PHRS data: 0xa9059cbb000000000000000000000000000000000000000000000000000000000000dead00000000000000000000000000000000000000000000000000000000000f4240 Details: execution reverted: Version: viem@2.57.11 | execution reverted: | Exec…(truncated))

EXPECTED OUTCOME
  State changes not fully available from simulation

EXECUTION GUARD (simulation-only)
  decision:    NO_GO
  reason:      2 blocking conditions: SIMULATION_REVERTED, MISSING_GAS_ESTIMATE.
  blocker:     [SIMULATION_REVERTED] The simulated transaction reverts: Revert reason unavailable (raw revert data: 0xe450d38c0000000000000000000000001111111111111111111111111111111111111111000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f4240).
  blocker:     [MISSING_GAS_ESTIMATE] Gas estimation failed: the transaction is unlikely to execute (Execution reverted for an unknown reason. Estimate Gas Arguments: from: 0x1111111111111111111111111111111111111111 to: 0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8 value: 0 PHRS data: 0xa9059cbb000000000000000000000000000000000000000000000000000000000000dead00000000000000000000000000000000000000000000000000000000000f4240 Details: execution reverted: Version: viem@2.57.11 | execution reverted: | Exec…(truncated))
  NO_GO — execution blocked

DISCLAIMER: A passing simulation is a point-in-time prediction, not a guarantee. Network state changes between simulation and any future execution. This tool never sends transactions.
════════════════════════════════════════════════════════════════════════
NO_GO — execution blocked

========================================================================
Demo finished. Decisions: success=GO, contract=GO, failure=NO_GO (expected).
GO means simulation passed. No transaction was sent. NO_GO — execution blocked.
All results above are LIVE read-only simulations against Pharos Atlantic Testnet RPC.
No transaction was broadcast at any point.
```

## Observed real-RPC behavior worth knowing

During development, one transient node-side anomaly was observed: a
`WPHRS.symbol()` `eth_call` that succeeds consistently otherwise came back
once as `execution reverted` with **empty revert data** from the RPC
cluster. The executor did exactly what it is designed to do:

- reported `status: REVERTED` with `Revert reason unavailable`
  (it never invents a reason),
- failed closed with `NO_GO — execution blocked`,
- and did **not** retry or fabricate a passing result.

This is an honest limitation of `eth_call`-based simulation on a
load-balanced public RPC: an infrastructure hiccup and a genuine
empty-data revert are indistinguishable on the wire. Re-running the same
simulation succeeded (5/5 in follow-up checks), and the guard's
fail-closed behavior is the safe default. When in doubt, re-run the
simulation against a fresh block before drawing conclusions.

## Failure demo details

The failing example reverts deterministically because the sender
(`0x1111…1111`) holds 0 USDC. The token reverts with a custom error
(raw revert data starting `0xe450d38c`, the well-known
`ERC20InsufficientBalance(address,uint256,uint256)` selector). Per the
project rules the decoder only decodes `Error(string)` and
`Panic(uint256)` and **never invents reasons**, so the report shows
`Revert reason unavailable` together with the raw revert data, and the
gas estimation also fails (the transaction cannot execute) — producing a
`NO_GO` with two blocking conditions.
