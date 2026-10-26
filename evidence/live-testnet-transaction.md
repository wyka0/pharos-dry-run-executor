# Live Pharos Atlantic Testnet Transaction — Evidence

> Real native PHRS transfer, signed locally with viem (private-key account)
> and submitted via `eth_sendRawTransaction` after explicit `BROADCAST`
> confirmation. All values below are captured from the actual RPC
> transaction (`eth_getTransactionByHash`) and receipt.
> No private key material is included in this file.

| Field | Value |
|-------|-------|
| Timestamp (evidence captured) | 2026-10-26T20:15:18.167Z |
| Broadcast at | 2026-10-26T20:14:50.623Z |
| Network | Pharos Atlantic Testnet |
| Chain ID | 688689 |
| RPC endpoint | https://atlantic.dplabs-internal.com |
| Sender | `0x299ce4113abf88f4997737184aa8a7a3d58ac15c` |
| Recipient | `0x2f18ddfa8ffe00c9881222658bf75f38661fd6bf` |
| Amount | 1000000000000000 wei (0.001 PHRS) |
| Transaction hash | `0xb4585916142d12703c45cd4bb468d91ed4548887470d9fd8c1db659734764b8f` |
| Block number | 31917028 |
| Receipt status | success |
| Gas used | 21000 |
| Effective gas price | 10000000000 wei (10 gwei) |
| Actual fee | 210000000000000 wei (0.000210000000000000 PHRS) |
| Explorer URL | https://atlantic.pharosscan.xyz/tx/0xb4585916142d12703c45cd4bb468d91ed4548887470d9fd8c1db659734764b8f |
| Confirmations (at capture) | 3 |
| Pre-broadcast simulation | status SUCCESS, guard GO |

Fee math: `actualFeeWei = gasUsed × effectiveGasPrice` (BigInt, exact).
Formatted: 210000000000000 wei = 0.000210000000000000 PHRS.
