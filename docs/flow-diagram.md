# Dry-Run Executor — Flow

> **This project NEVER broadcasts transactions.** Every arrow below is a
> local computation or a *read-only* RPC call. There is no signing, no
> private key, and no `eth_sendTransaction` / `eth_sendRawTransaction`
> anywhere in the codebase.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         User request                                │
│   "Simulate this transaction before sending" (JSON file / example)  │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                             Skill                                   │
│  skills/dry-run-executor/SKILL.md                                   │
│  → routes the user to the CLI:                                      │
│      npm run dry-run -- --transaction ./tx.json                     │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     1. Transaction validation                       │
│  src/validation/transaction.ts                                      │
│  • addresses (0x + 40 hex, checksum-aware)                          │
│  • calldata: 0x-prefixed, even-length hex                           │
│  • value: decimal/0x-hex wei string, or valuePhrs decimal           │
│  • required fields, positive gasLimit                               │
│  FAIL → status ERROR (VALIDATION), guard NO_GO  [no RPC calls made] │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ valid
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     2. RPC verification (read-only)                 │
│  src/rpc/client.ts — eth_chainId, eth_blockNumber                   │
│  • endpoint reachable?                                              │
│  • chain ID == 688689 (Pharos Atlantic Testnet)?                    │
│  FAIL → status ERROR (RPC), guard NO_GO  [nothing is fabricated]    │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ verified
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     3. RPC simulation (read-only)                   │
│  src/simulation/simulate.ts — eth_call                              │
│  SUCCESS ──────────────────────► keep returnData                    │
│  REVERTED ──► decode revert (Error(string) / Panic(uint256)),       │
│               else "Revert reason unavailable" + raw data           │
│  RPC error ──► status ERROR (RPC) — never reported as a revert      │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     4. Gas estimation (read-only)                   │
│  src/simulation/estimate-gas.ts — eth_estimateGas, eth_gasPrice     │
│  src/simulation/calculate-cost.ts — cost = gasLimit × gasPrice      │
│  (BigInt wei math; cost shown in wei and PHRS)                      │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  5. Expected-outcome analysis (read-only)           │
│  src/analysis/balance-diff.ts — eth_getBalance                      │
│  • native transfer: predicted sender/recipient balances after       │
│    value + gas cost — labeled  PREDICTED — NOT CONFIRMED            │
│  • contract call: "State changes not fully available from           │
│    simulation" (eth_call cannot reveal storage changes)             │
│  • sufficient-funds re-check (some nodes skip balance checks in     │
│    eth_call — the analysis catches what the node does not)          │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│              6. Success/failure decision (typed result)             │
│  SimulationResult: status SUCCESS | REVERTED | ERROR                │
│  complete: true only when every step produced definitive results    │
│  (uncertainty → complete:false → guard fails closed)                │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     7. Execution guard                              │
│  src/execution/execution-guard.ts                                   │
│  GO  requires: SUCCESS + complete + verified network + gas estimate │
│  NO_GO reasons: revert, RPC error, gas estimation failure,          │
│  validation failure, unverified network, insufficient funds,        │
│  incomplete/uncertain result                                        │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                 ┌──────────────┴──────────────┐
                 ▼                             ▼
        ┌────────────────┐            ┌──────────────────┐
        │      GO        │            │      NO_GO       │
        │ "GO means      │            │ "NO_GO —         │
        │ simulation     │            │  execution       │
        │ passed. No     │            │  blocked"        │
        │ transaction    │            └──────────────────┘
        │ was sent."     │
        └────────────────┘
                 └──────────────┬──────────────┘
                                ▼
                  ┌───────────────────────────────┐
                  │   END OF PIPELINE (always)    │
                  │  No transaction is ever sent. │
                  │  There is no broadcast step.  │
                  └───────────────────────────────┘
```

## Read-only RPC methods used

| Method | Purpose |
|--------|---------|
| `eth_chainId` | Verify the endpoint is Pharos Atlantic Testnet (688689) |
| `eth_blockNumber` | Record the simulation block for the report |
| `eth_getBalance` | Sender/recipient balances for outcome analysis |
| `eth_gasPrice` | Fee assumption for cost estimation |
| `eth_call` | Execute the transaction in simulation (no state committed) |
| `eth_estimateGas` | Estimate the gas limit |

Methods that are **never** used: `eth_sendTransaction`,
`eth_sendRawTransaction`, `eth_sign*`, `personal_*`, `wallet_*`, and any
wallet/broadcasting SDK function. There is no private key anywhere in the
project.
