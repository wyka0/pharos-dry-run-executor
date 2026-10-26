/**
 * Unit tests: revert reason decoding (Error(string), Panic(uint256),
 * undecodable data) and RPC error classification. No network access.
 */

import { describe, expect, it } from 'vitest';
import {
  REASON_UNAVAILABLE,
  decodeRevertData,
  describeRevertData,
} from '../src/simulation/decode-revert.js';
import { classifyRpcError } from '../src/rpc/errors.js';

const encodeString = (message: string): string => {
  const len = message.length;
  const lenHex = len.toString(16).padStart(64, '0');
  let dataHex = '';
  for (let i = 0; i < message.length; i++) {
    dataHex += message.charCodeAt(i).toString(16).padStart(2, '0');
  }
  while (dataHex.length % 64 !== 0) dataHex += '0';
  return (
    '0x08c379a0' +
    '0000000000000000000000000000000000000000000000000000000000000020' +
    lenHex +
    dataHex
  );
};

const encodePanic = (code: bigint): string =>
  '0x4e487b71' + code.toString(16).padStart(64, '0');

describe('decodeRevertData — Error(string)', () => {
  it('decodes an Error(string) revert message', () => {
    const data = encodeString('ERC20: transfer amount exceeds balance') as `0x${string}`;
    const decoded = decodeRevertData(data);
    expect(decoded).toMatchObject({
      kind: 'Error(string)',
      message: 'ERC20: transfer amount exceeds balance',
    });
  });

  it('decodes an empty Error(string) message', () => {
    const data = encodeString('') as `0x${string}`;
    const decoded = decodeRevertData(data);
    expect(decoded).toMatchObject({ kind: 'Error(string)', message: '' });
  });
});

describe('decodeRevertData — Panic(uint256)', () => {
  it('decodes Panic(0x11) as an arithmetic overflow/underflow', () => {
    const decoded = decodeRevertData(encodePanic(0x11n) as `0x${string}`);
    expect(decoded).toMatchObject({
      kind: 'Panic(uint256)',
      panicCode: 0x11n,
      panicName: 'Arithmetic operation underflowed or overflowed',
    });
  });

  it('decodes Panic(0x12) as division by zero', () => {
    const decoded = decodeRevertData(encodePanic(0x12n) as `0x${string}`);
    expect(decoded).toMatchObject({ kind: 'Panic(uint256)', panicCode: 0x12n });
  });

  it('names unknown panic codes without inventing a cause', () => {
    const decoded = decodeRevertData(encodePanic(0x99n) as `0x${string}`);
    expect(decoded).toMatchObject({ kind: 'Panic(uint256)', panicCode: 0x99n });
    if (decoded?.kind === 'Panic(uint256)') {
      expect(decoded.panicName).toBe('Unknown Solidity panic code');
    }
  });
});

describe('decodeRevertData — undecodable input', () => {
  it('returns null for empty revert data', () => {
    expect(decodeRevertData(null)).toBeNull();
    expect(decodeRevertData('0x')).toBeNull();
  });

  it('returns UNDECODABLE for custom error selectors', () => {
    // ERC20InsufficientBalance(address,uint256,uint256)
    const data =
      '0xe450d38c0000000000000000000000001111111111111111111111111111111111111111' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '000000000000000000000000000000000000000000000000000000000000f4240' as `0x${string}`;
    const decoded = decodeRevertData(data);
    expect(decoded).toMatchObject({ kind: 'UNDECODABLE', message: 'Revert reason unavailable' });
  });

  it('returns UNDECODABLE for malformed Error(string) payloads', () => {
    const data = ('0x08c379a0' + 'ff'.repeat(64)) as `0x${string}`;
    const decoded = decodeRevertData(data);
    expect(decoded).toMatchObject({ kind: 'UNDECODABLE', message: 'Revert reason unavailable' });
  });
});

describe('describeRevertData', () => {
  it('surfaces "Revert reason unavailable" when there is no data', () => {
    const out = describeRevertData(null);
    expect(out.decoded).toBeNull();
    expect(out.displayReason).toBe(REASON_UNAVAILABLE);
  });

  it('includes raw data for undecodable reasons', () => {
    const data = ('0xdeadbeef' + '00'.repeat(32)) as `0x${string}`;
    const out = describeRevertData(data);
    expect(out.displayReason).toContain(REASON_UNAVAILABLE);
    expect(out.displayReason).toContain('0xdeadbeef');
  });

  it('returns the decoded message for Error(string)', () => {
    const out = describeRevertData(encodeString('Still locked') as `0x${string}`);
    expect(out.displayReason).toBe('Still locked');
  });
});

describe('classifyRpcError', () => {
  it('extracts revert data from node-shaped errors (code 3 + data)', () => {
    const err = Object.assign(new Error('execution reverted: '), {
      code: 3,
      data: '0x08c379a0abcdef',
    });
    const c = classifyRpcError(err);
    expect(c.kind).toBe('SIMULATION_EXECUTION');
    expect(c.revertData).toBe('0x08c379a0abcdef');
  });

  it('finds revert data nested in viem-style cause chains', () => {
    const inner = Object.assign(new Error('RPC Request failed'), {
      code: 3,
      data: '0x4e487b710000000000000000000000000000000000000000000000000000000000000011',
    });
    const outer = new Error('Call Execution Error', { cause: inner });
    const c = classifyRpcError(outer);
    expect(c.kind).toBe('SIMULATION_EXECUTION');
    expect(c.revertData).toContain('4e487b71');
  });

  it('classifies infrastructure failures as RPC, not revert', () => {
    const err = Object.assign(new Error('fetch failed'), { name: 'HttpRequestError' });
    expect(classifyRpcError(err).kind).toBe('RPC');
    expect(classifyRpcError(new Error('connect ECONNREFUSED 1.2.3.4:443')).kind).toBe('RPC');
    expect(classifyRpcError(new Error('request timed out')).kind).toBe('RPC');
  });

  it('classifies execution-level messages as simulation failures', () => {
    expect(classifyRpcError(new Error('insufficient funds for gas * price + value')).kind).toBe(
      'SIMULATION_EXECUTION',
    );
    expect(classifyRpcError(new Error('execution reverted')).kind).toBe('SIMULATION_EXECUTION');
  });

  it('defaults unknown failures to RPC (fail closed)', () => {
    expect(classifyRpcError(new Error('something strange')).kind).toBe('RPC');
  });
});
