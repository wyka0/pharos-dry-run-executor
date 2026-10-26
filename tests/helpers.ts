/**
 * Shared test helpers: a configurable fake RPC client and a factory for
 * minimal SimulationResult objects. Unit tests never touch the network.
 */

import type { RpcLike } from '../src/rpc/client.js';
import type { SimulationResult } from '../src/types.js';

export const ALLOWED_RPC_METHODS = new Set([
  'getChainId',
  'getBlockNumber',
  'getBalance',
  'getGasPrice',
  'call',
  'estimateGas',
]);

export interface FakeRpcOptions {
  chainId?: number;
  blockNumber?: bigint;
  balances?: Record<string, bigint>;
  gasPrice?: bigint;
  /** Result (or thrown error) for eth_call. */
  call?: { data?: `0x${string}` } | Error;
  /** Result (or thrown error) for eth_estimateGas. */
  estimateGas?: bigint | Error;
  /** Error for getGasPrice. */
  gasPriceError?: Error;
  /** Error for getBalance. */
  balanceError?: Error;
  /** Error for getChainId / getBlockNumber. */
  chainError?: Error;
}

export interface FakeRpc extends RpcLike {
  /** Every method name invoked on this fake, in call order. */
  readonly calls: string[];
}

export function createFakeRpc(options: FakeRpcOptions = {}): FakeRpc {
  const balances = options.balances ?? {};
  const calls: string[] = [];

  const client: FakeRpc = {
    calls,
    async getChainId() {
      calls.push('getChainId');
      if (options.chainError !== undefined) throw options.chainError;
      return options.chainId ?? 688689;
    },
    async getBlockNumber() {
      calls.push('getBlockNumber');
      if (options.chainError !== undefined) throw options.chainError;
      return options.blockNumber ?? 1_000_000n;
    },
    async getBalance(args) {
      calls.push('getBalance');
      if (options.balanceError !== undefined) throw options.balanceError;
      return balances[args.address.toLowerCase()] ?? 0n;
    },
    async getGasPrice() {
      calls.push('getGasPrice');
      if (options.gasPriceError !== undefined) throw options.gasPriceError;
      return options.gasPrice ?? 10_000_000_000n;
    },
    async call(_args) {
      calls.push('call');
      const result = options.call ?? { data: '0x' };
      if (result instanceof Error) throw result;
      return result;
    },
    async estimateGas(_args) {
      calls.push('estimateGas');
      const result = options.estimateGas ?? 21_000n;
      if (result instanceof Error) throw result;
      return result;
    },
  };
  return client;
}

const BASE_RESULT: SimulationResult = {
  status: 'SUCCESS',
  complete: true,
  network: {
    chainId: 688689,
    chainName: 'Pharos Atlantic Testnet',
    rpcUrl: 'https://atlantic.dplabs-internal.com',
    blockNumber: 1_000_000n,
    verified: true,
    verificationError: null,
  },
  input: {
    from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    to: '0x000000000000000000000000000000000000dEaD',
    valueWei: 1_000_000_000_000_000n,
    data: '0x',
  },
  description: null,
  returnData: '0x',
  gasEstimate: {
    gasLimit: 21_000n,
    gasPriceWei: 10_000_000_000n,
    gasCostWei: 210_000_000_000_000n,
    gasCostPhrs: '0.000210000000000000',
    feeAssumptions: {
      method: 'eth_estimateGas + eth_gasPrice',
      gasPriceWei: 10_000_000_000n,
      note: 'test assumption',
    },
  },
  gasEstimateError: null,
  revert: null,
  failureKind: null,
  rawError: null,
  validationIssues: [],
  balanceReads: {
    senderWei: 277_943_753_174_938_036n,
    recipientWei: 3_762_145_791_673_329_147n,
    errors: [],
  },
  outcome: {
    kind: 'NATIVE_TRANSFER',
    senderBalanceBeforeWei: 277_943_753_174_938_036n,
    recipientBalanceBeforeWei: 3_762_145_791_673_329_147n,
    transferValueWei: 1_000_000_000_000_000n,
    gasCostWei: 210_000_000_000_000n,
    predictedSenderBalanceAfterWei: 276_733_753_174_938_036n,
    predictedRecipientBalanceAfterWei: 3_763_145_791_673_329_147n,
    sufficientFunds: true,
    warnings: [],
  },
  warnings: [],
  startedAtIso: '2026-01-01T00:00:00.000Z',
  finishedAtIso: '2026-01-01T00:00:01.000Z',
  simulationOnly: true,
};

/** A complete, successful SimulationResult; override fields as needed. */
export function makeResult(overrides: Partial<SimulationResult> = {}): SimulationResult {
  return { ...BASE_RESULT, ...overrides };
}
