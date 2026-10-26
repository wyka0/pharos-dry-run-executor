/**
 * Core types for the Dry-Run Executor.
 *
 * All wei/gas arithmetic uses `bigint`. Floating-point numbers are never
 * used for value math.
 *
 * SAFETY: this module (and the whole project) is simulation-only. There is
 * no type, function, or code path that signs or broadcasts a transaction.
 */

/** Final simulation outcome for the simulated transaction. */
export type SimulationStatus = 'SUCCESS' | 'REVERTED' | 'ERROR';

/**
 * Why a simulation ended in ERROR. An RPC failure must never be reported as
 * a contract revert, and vice versa.
 */
export type FailureKind =
  | 'VALIDATION'
  | 'RPC'
  | 'GAS_ESTIMATION'
  | 'SIMULATION_REVERT'
  | 'UNKNOWN';

/** A validation problem found in the transaction input. */
export interface ValidationIssue {
  field: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; value: TransactionInput }
  | { ok: false; issues: ValidationIssue[] };

/** Validated, normalized transaction input. */
export interface TransactionInput {
  /** Sender address (checksummed). Used only as eth_call/estimateGas `from`. */
  from: `0x${string}`;
  /** Recipient / contract address (checksummed). */
  to: `0x${string}`;
  /** Value in wei (bigint). */
  valueWei: bigint;
  /** Calldata, normalized to '0x' when empty. */
  data: `0x${string}`;
  /** User-supplied gas limit in gas units, if provided. */
  gasLimit?: bigint;
  /** Optional human description shown in reports. */
  description?: string;
}

/** Loose, unvalidated transaction request as accepted from users/files. */
export interface RawTransactionRequest {
  from?: unknown;
  to?: unknown;
  /** Value in wei. Accepts decimal or 0x-hex strings. */
  value?: unknown;
  /** Value in PHRS as an exact decimal string (converted to wei, no floats). */
  valuePhrs?: unknown;
  data?: unknown;
  /** Gas limit in gas units. Accepts decimal or 0x-hex strings. */
  gasLimit?: unknown;
  description?: unknown;
}

/** How the gas price used for cost estimation was obtained. */
export interface FeeAssumptions {
  /** RPC method used, e.g. 'eth_gasPrice'. */
  method: string;
  /** Flat gas price assumption in wei per gas unit. */
  gasPriceWei: bigint;
  /** Human explanation of the assumption and its limits. */
  note: string;
}

/** Gas estimation + cost result (all bigint wei math). */
export interface GasEstimate {
  /** Gas limit in gas units (not wei). */
  gasLimit: bigint;
  /** Assumed gas price in wei per gas unit. */
  gasPriceWei: bigint;
  /** gasLimit * gasPriceWei, in wei. */
  gasCostWei: bigint;
  /** Same cost rendered as an exact decimal PHRS string. */
  gasCostPhrs: string;
  feeAssumptions: FeeAssumptions;
}

export type DecodedRevert =
  | { kind: 'Error(string)'; message: string; raw: `0x${string}` }
  | {
      kind: 'Panic(uint256)';
      panicCode: bigint;
      panicName: string;
      raw: `0x${string}`;
    }
  | { kind: 'UNDECODABLE'; raw: `0x${string}`; message: 'Revert reason unavailable' };

/** Revert information attached to a REVERTED result. */
export interface RevertInfo {
  /** Raw revert data from the node (may be '0x' when none was returned). */
  revertData: `0x${string}` | null;
  /** Decoded reason, or null when the node returned no revert data. */
  decoded: DecodedRevert | null;
  /** Human-facing reason; 'Revert reason unavailable' when not decodable. */
  displayReason: string;
}

/** Network facts captured during the run. */
export interface NetworkInfo {
  chainId: number;
  chainName: string;
  rpcUrl: string;
  explorerUrl?: string;
  /** Current block seen by the node, when reachable. */
  blockNumber: bigint | null;
  /** True only when the RPC answered and its chain ID matches config. */
  verified: boolean;
  /** Why verification failed, when it did. */
  verificationError: string | null;
}

/** Predicted balance changes for a plain native PHRS transfer. */
export interface NativeTransferAnalysis {
  kind: 'NATIVE_TRANSFER';
  senderBalanceBeforeWei: bigint;
  recipientBalanceBeforeWei: bigint;
  transferValueWei: bigint;
  gasCostWei: bigint;
  /** Predicted sender balance after value + gas cost; null when it would go negative. */
  predictedSenderBalanceAfterWei: bigint | null;
  /** Predicted recipient balance after receiving value. */
  predictedRecipientBalanceAfterWei: bigint;
  /** Whether the sender can cover value + estimated gas cost. */
  sufficientFunds: boolean;
  warnings: string[];
}

/** Placeholder analysis for contract calls. */
export interface ContractCallAnalysis {
  kind: 'CONTRACT_CALL';
  target: `0x${string}`;
  calldata: `0x${string}`;
  note: 'State changes not fully available from simulation';
}

export type OutcomeAnalysis = NativeTransferAnalysis | ContractCallAnalysis;

/** Raw balance reads (kept even when predictions are not possible). */
export interface BalanceReads {
  senderWei: bigint | null;
  recipientWei: bigint | null;
  errors: string[];
}

/** Full, typed simulation result. */
export interface SimulationResult {
  status: SimulationStatus;
  /**
   * True only when every pipeline step produced a definitive result:
   * network verified, simulation executed, gas estimated, outcome analyzed
   * (or the transaction definitively reverts). The execution guard blocks
   * anything incomplete or uncertain.
   */
  complete: boolean;
  network: NetworkInfo;
  input: TransactionInput;
  description: string | null;
  /** Raw return data from eth_call when status is SUCCESS. */
  returnData: `0x${string}` | null;
  gasEstimate: GasEstimate | null;
  /** Present when gas estimation failed (result may still have a status). */
  gasEstimateError: string | null;
  revert: RevertInfo | null;
  /** Present when status is ERROR. */
  failureKind: FailureKind | null;
  /** Raw error details (e.g. when revert decoding is impossible). */
  rawError: string | null;
  /** Validation issues, when input was rejected. */
  validationIssues: ValidationIssue[];
  balanceReads: BalanceReads | null;
  /** Outcome analysis; null when it cannot be reliably derived. */
  outcome: OutcomeAnalysis | null;
  warnings: string[];
  startedAtIso: string;
  finishedAtIso: string;
  /** Always true — this project never broadcasts. */
  simulationOnly: true;
}

export type GuardDecision = 'GO' | 'NO_GO';

/** A single blocking condition found by the execution guard. */
export interface GuardBlocker {
  /** Stable machine-readable code, e.g. 'SIMULATION_REVERTED'. */
  code: string;
  /** Human-readable explanation. */
  detail: string;
}

/** Execution guard verdict. */
export interface GuardResult {
  decision: GuardDecision;
  /** Summary reason for the decision. */
  reason: string;
  blockers: GuardBlocker[];
  decidedAtIso: string;
  /** Always true — the guard is advisory; nothing is ever executed. */
  simulationOnly: true;
}

/** A completed dry run: simulation result + guard decision. */
export interface DryRunReport {
  result: SimulationResult;
  guard: GuardResult;
}
