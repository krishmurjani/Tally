/**
 * Exact rational arithmetic for rates and FX (BigInt). Used wherever a money amount is
 * multiplied by a decimal like 11.55% or ₹90/USD, so results are rounded exactly once,
 * by an explicit rule (half away from zero), never by float error.
 */

export interface Ratio {
  num: bigint;
  den: bigint;
}

const DEC_RE = /^([+-])?(\d+)(?:\.(\d+))?$/;

/** "11.55" → 1155/100. */
export function parseRatio(s: string): Ratio {
  const m = DEC_RE.exec(s.trim());
  if (!m) throw new Error(`Not a decimal: ${JSON.stringify(s)}`);
  const [, sign, whole, frac = ""] = m;
  const den = 10n ** BigInt(frac.length);
  const num = BigInt(whole! + frac) * (sign === "-" ? -1n : 1n);
  return { num, den };
}

export function isDecimalString(s: string): boolean {
  return DEC_RE.test(s.trim());
}

export function ratio(num: bigint | number, den: bigint | number = 1n): Ratio {
  const d = BigInt(den);
  if (d === 0n) throw new Error("Zero denominator");
  return { num: BigInt(num), den: d };
}

export function mul(a: Ratio, b: Ratio): Ratio {
  return { num: a.num * b.num, den: a.den * b.den };
}

export function div(a: Ratio, b: Ratio): Ratio {
  if (b.num === 0n) throw new Error("Division by zero");
  const sign = b.num < 0n ? -1n : 1n;
  return { num: a.num * b.den * sign, den: a.den * b.num * sign };
}

export function sub(a: Ratio, b: Ratio): Ratio {
  return { num: a.num * b.den - b.num * a.den, den: a.den * b.den };
}

export function isZero(r: Ratio): boolean {
  return r.num === 0n;
}

/** Round num/den to the nearest integer, halves away from zero. */
export function roundRatio(r: Ratio): bigint {
  const { num, den } = r.den < 0n ? { num: -r.num, den: -r.den } : r;
  const neg = num < 0n;
  const abs = neg ? -num : num;
  const q = (2n * abs + den) / (2n * den);
  return neg ? -q : q;
}

/** Integer minor amount × ratio, rounded half away from zero, as a safe JS number. */
export function applyRatio(minor: number, r: Ratio): number {
  const out = roundRatio(mul(ratio(minor), r));
  const n = Number(out);
  if (!Number.isSafeInteger(n)) throw new Error("Amount out of range");
  return n;
}

export function ratioToNumber(r: Ratio): number {
  return Number(r.num) / Number(r.den);
}
