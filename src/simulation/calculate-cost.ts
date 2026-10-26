/**
 * Gas cost calculation for the Dry-Run Executor.
 *
 * All arithmetic is BigInt / exact string math. Floating-point numbers are
 * never used for wei calculations.
 */

const WEI_PER_UNIT = 18n;
const GWEI_DECIMALS = 9n;

/** gasCostWei = gasLimit (gas units) * gasPriceWei (wei per gas unit). */
export function calculateGasCostWei(gasLimit: bigint, gasPriceWei: bigint): bigint {
  if (gasLimit < 0n || gasPriceWei < 0n) {
    throw new Error('gasLimit and gasPriceWei must be non-negative');
  }
  return gasLimit * gasPriceWei;
}

/**
 * Converts wei into an exact decimal string of `decimals` fractional units
 * (e.g. wei -> PHRS with decimals=18) using only BigInt and strings.
 */
export function weiToDecimalUnits(wei: bigint, decimals: number): string {
  if (decimals < 0) throw new Error('decimals must be >= 0');
  const scale = 10n ** BigInt(decimals);
  const negative = wei < 0n;
  const abs = negative ? -wei : wei;
  const whole = abs / scale;
  const frac = abs % scale;
  const fracStr =
    decimals === 0
      ? ''
      : '.' + frac.toString().padStart(decimals, '0');
  return (negative ? '-' : '') + whole.toString() + fracStr;
}

/** Formats wei as an exact PHRS decimal string. */
export function formatPhrs(wei: bigint): string {
  return weiToDecimalUnits(wei, Number(WEI_PER_UNIT));
}

/** Formats wei as an exact gwei decimal string. */
export function formatGwei(wei: bigint): string {
  return weiToDecimalUnits(wei, Number(GWEI_DECIMALS));
}

/** Builds the full gas estimate object, including fee assumptions. */
export function calculateCost(
  gasLimit: bigint,
  gasPriceWei: bigint,
  assumptions: {
    method: string;
    note: string;
  },
): {
  gasCostWei: bigint;
  gasCostPhrs: string;
  feeAssumptions: { method: string; gasPriceWei: bigint; note: string };
} {
  const gasCostWei = calculateGasCostWei(gasLimit, gasPriceWei);
  return {
    gasCostWei,
    gasCostPhrs: formatPhrs(gasCostWei),
    feeAssumptions: {
      method: assumptions.method,
      gasPriceWei,
      note: assumptions.note,
    },
  };
}

export const FEE_NOTE_ETH_GAS_PRICE =
  'Flat gas price from eth_gasPrice. Actual fee depends on the gas price at mining time; ' +
  'EIP-1559 priority fees, if any, are not modeled. This is an estimate, not a quote.';
