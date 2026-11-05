/**
 * Exact money arithmetic.
 *
 * Amounts are carried as bigint "units" with four implied decimals (the same
 * scale as the NUMERIC(20,4) database columns), so sums never suffer from
 * floating-point rounding. Display precision is a separate concern handled by
 * the currency's `decimals` (IQD = 0, USD = 2).
 */
export const SCALE_DIGITS = 4;
export const SCALE = 10_000n;

export type Units = bigint;

/** Converts a database/JSON numeric (number or decimal string) to units. */
export function toUnits(value: number | string | bigint | null | undefined): Units {
  if (value === null || value === undefined || value === '') return 0n;
  if (typeof value === 'bigint') return value * SCALE;
  const text = typeof value === 'number' ? numberToPlainString(value) : String(value).trim();
  return parseDecimal(text);
}

function numberToPlainString(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError('Amount is not a finite number');
  // toFixed avoids exponent notation for the magnitudes used in accounting.
  return value.toFixed(SCALE_DIGITS);
}

function parseDecimal(text: string): Units {
  const match = /^([+-])?(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match || (match[2] === '' && (match[3] === undefined || match[3] === ''))) {
    throw new RangeError(`Invalid decimal amount: ${text}`);
  }
  const sign = match[1] === '-' ? -1n : 1n;
  const whole = BigInt(match[2] || '0');
  const fraction = (match[3] ?? '').padEnd(SCALE_DIGITS + 1, '0');
  let fractional = BigInt(fraction.slice(0, SCALE_DIGITS));
  // Round half away from zero on the fifth decimal digit.
  if (Number(fraction[SCALE_DIGITS]) >= 5) fractional += 1n;
  return sign * (whole * SCALE + fractional);
}

/** Serialises units as a plain decimal string for database calls. */
export function unitsToDecimalString(units: Units): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const whole = abs / SCALE;
  const fraction = (abs % SCALE).toString().padStart(SCALE_DIGITS, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole.toString()}${fraction ? `.${fraction}` : ''}`;
}

export function unitsToNumber(units: Units): number {
  return Number(unitsToDecimalString(units));
}

export function sumUnits(values: Iterable<Units>): Units {
  let total = 0n;
  for (const value of values) total += value;
  return total;
}

export function absUnits(units: Units): Units {
  return units < 0n ? -units : units;
}

export function maxUnits(a: Units, b: Units): Units {
  return a > b ? a : b;
}

/** True when the amount has no more decimals than the currency allows. */
export function fitsCurrencyPrecision(units: Units, decimals: number): boolean {
  const step = 10n ** BigInt(SCALE_DIGITS - Math.min(decimals, SCALE_DIGITS));
  return units % step === 0n;
}

export interface FormatOptions {
  /** Number of decimals shown, normally the currency's decimals. */
  decimals: number;
  /** Show negative values in parentheses (financial statement style). */
  parentheses?: boolean;
  /** Render zero as an empty string or dash instead of 0. */
  zero?: 'show' | 'blank' | 'dash';
}

/** Formats units with Latin digits and comma grouping, e.g. 1,000,000. */
export function formatUnits(units: Units, options: FormatOptions): string {
  if (units === 0n) {
    if (options.zero === 'blank') return '';
    if (options.zero === 'dash') return '—';
  }
  const decimals = Math.max(0, Math.min(options.decimals, SCALE_DIGITS));
  const negative = units < 0n;
  let abs = negative ? -units : units;
  const divisor = 10n ** BigInt(SCALE_DIGITS - decimals);
  // Round half away from zero to the display precision.
  const remainder = abs % divisor;
  abs = abs / divisor + (remainder * 2n >= divisor && divisor > 1n ? 1n : 0n);
  const factor = 10n ** BigInt(decimals);
  const whole = (abs / factor).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = decimals > 0 ? `.${(abs % factor).toString().padStart(decimals, '0')}` : '';
  const body = `${whole}${fraction}`;
  if (!negative || abs === 0n) return body;
  return options.parentheses ? `(${body})` : `-${body}`;
}

/**
 * Parses user input such as "1,000,000" or "250.50" into units.
 * Returns null for empty input and throws for malformed input.
 */
export function parseAmountInput(input: string): Units | null {
  const cleaned = input.replace(/[,\s٬]/g, '').replace(/٫/g, '.');
  const normalised = cleaned.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  if (normalised === '') return null;
  return parseDecimal(normalised);
}

export function isValidAmountInput(input: string): boolean {
  try {
    parseAmountInput(input);
    return true;
  } catch {
    return false;
  }
}
