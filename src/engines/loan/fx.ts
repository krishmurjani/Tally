/**
 * Live INR-per-USD rate from Frankfurter (https://frankfurter.dev): a free, key-less service that republishes the
 * European Central Bank's daily reference rates. It is a mid-market rate; your bank or transfer service charges a
 * little more, which the planner's "transfer fee" covers.
 */
export interface LiveFx {
  /** Rupees per dollar, two decimals, e.g. "94.25". */
  rate: string;
  /** The date the ECB published this rate for (YYYY-MM-DD). */
  date: string;
}

/** Validate Frankfurter's JSON; a nonsense rate is rejected rather than quietly loaded into a plan. */
export function parseFrankfurter(json: unknown): LiveFx | null {
  if (typeof json !== "object" || json === null) return null;
  const j = json as { base?: unknown; date?: unknown; rates?: { INR?: unknown } };
  const inr = j.rates?.INR;
  if (j.base !== "USD" || typeof inr !== "number" || !Number.isFinite(inr)) return null;
  if (inr < 30 || inr > 300) return null; // far outside anything the rupee has done
  if (typeof j.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(j.date)) return null;
  return { rate: inr.toFixed(2), date: j.date };
}
