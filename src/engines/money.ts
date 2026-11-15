/**
 * Money is always an integer number of minor units (cents for USD, paise for INR).
 * Decimal strings are parsed exactly by string splitting — never via parseFloat.
 */

export type Currency = "USD" | "INR";

export const MINOR_PER_MAJOR = 100;

export class MoneyParseError extends Error {
  constructor(input: string, why: string) {
    super(`Cannot parse amount ${JSON.stringify(input)}: ${why}`);
    this.name = "MoneyParseError";
  }
}

const DECIMAL_RE = /^([+-])?(\d+)(?:\.(\d*))?$/;

/**
 * Parse a decimal string like "25.0", "-4.49", "1,234.56", "₹9,846" into minor units.
 * Throws if the string has more than 2 fractional digits (we never round silently)
 * or isn't a plain decimal.
 */
export function parseMinor(input: string): number {
  const cleaned = input.trim().replace(/[,\s₹$]/g, "");
  const m = DECIMAL_RE.exec(cleaned);
  if (!m) throw new MoneyParseError(input, "not a decimal number");
  const [, sign, whole, fracRaw = ""] = m;
  // Trailing zeros beyond 2 places are harmless ("25.000"); anything else is real precision.
  const frac = fracRaw.replace(/0+$/, "");
  if (frac.length > 2) throw new MoneyParseError(input, "more than 2 decimal places");
  const minor = Number(whole) * MINOR_PER_MAJOR + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor)) throw new MoneyParseError(input, "out of range");
  return sign === "-" ? -minor : minor;
}

export function isParsableMinor(input: string): boolean {
  try {
    parseMinor(input);
    return true;
  } catch {
    return false;
  }
}

export function sumMinor(values: Iterable<number>): number {
  let total = 0;
  for (const v of values) {
    if (!Number.isSafeInteger(v)) throw new Error(`Non-integer minor amount: ${v}`);
    total += v;
  }
  return total;
}

function groupWestern(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Indian grouping: last 3 digits, then groups of 2 (₹1,24,433 · ₹88,26,923). */
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest},${last3}`;
}

export interface FormatOptions {
  /** "always" shows 2 decimals; "auto" hides them when zero; "never" rounds display to whole units. */
  decimals?: "always" | "auto" | "never";
  /** Show a leading "+" for positive amounts. */
  signed?: boolean;
}

/** Format minor units for display. Display-only: never feed the result back into math. */
export function formatMoney(minor: number, currency: Currency, opts: FormatOptions = {}): string {
  const { decimals = currency === "USD" ? "always" : "auto", signed = false } = opts;
  const neg = minor < 0;
  let abs = Math.abs(minor);
  let showFrac: boolean;
  if (decimals === "never") {
    abs = Math.round(abs / MINOR_PER_MAJOR) * MINOR_PER_MAJOR;
    showFrac = false;
  } else {
    showFrac = decimals === "always" || abs % MINOR_PER_MAJOR !== 0;
  }
  const whole = String(Math.floor(abs / MINOR_PER_MAJOR));
  const frac = String(abs % MINOR_PER_MAJOR).padStart(2, "0");
  const grouped = currency === "INR" ? groupIndian(whole) : groupWestern(whole);
  const symbol = currency === "INR" ? "₹" : "$";
  const body = `${symbol}${grouped}${showFrac ? `.${frac}` : ""}`;
  if (neg) return `−${body}`;
  return signed && minor > 0 ? `+${body}` : body;
}

export const formatUSD = (minor: number, opts?: FormatOptions) => formatMoney(minor, "USD", opts);
export const formatINR = (minor: number, opts?: FormatOptions) => formatMoney(minor, "INR", opts);

/** Plain "1821.67" style string (for CSV export / reports), exact. */
export function minorToDecimalString(minor: number): string {
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const s = `${Math.floor(abs / MINOR_PER_MAJOR)}.${String(abs % MINOR_PER_MAJOR).padStart(2, "0")}`;
  return neg ? `-${s}` : s;
}
