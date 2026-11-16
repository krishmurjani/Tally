/**
 * The Credila portal's "Pay Now → Part payment" rules, reproduced from the portal screens and the loan agreement.
 *
 *  - A payment is applied in this order: charges → overdue → interest → principal (agreement cl. 2.7(g), portal note).
 *  - "Interest" is everything accrued and not yet paid since the interest was last added to principal.
 *  - So the minimum part payment is that interest plus ₹1 (so at least ₹1 reaches principal) — your ₹3,15,606.
 *  - The maximum is the whole outstanding amount minus ₹1 — your ₹89,94,442. (Paying it all is a foreclosure.)
 *  - There is no prepayment charge on a floating-rate loan (agreement cl. 2.9(a)); the fixed-rate 2% table doesn't apply.
 *  - Interest for the days since the last due date is the outstanding × rate × days / 360, truncated to a rupee.
 *
 * Verified against the portal (screenshots of 2026-11-16): outstanding ₹89,94,443, minimum ₹3,15,606,
 * maximum ₹89,94,442, and a ₹3,16,000 payment splitting into ₹3,15,605 interest + ₹395 principal.
 */
import type { IsoDate } from "../dates";
import { div, mul, parseRatio, ratio } from "../rational";

export interface PartPaymentFacts {
  /** The latest due date that has passed. */
  lastDueDate: IsoDate;
  /** Total outstanding right after that due date (principal + interest build-up), paise. */
  outstandingAfterDueMinor: number;
  /** Principal as of the last time interest was added to it, paise. */
  principalAtRollupMinor: number;
  annualPercent: string;
}

export interface PartPaymentQuote {
  on: IsoDate;
  /** Outstanding today: balance after the last due date plus interest for the days since. */
  outstandingMinor: number;
  principalMinor: number;
  /** Interest accrued and unpaid today (what the portal calls "interest"). */
  interestMinor: number;
  minimumMinor: number;
  maximumMinor: number;
}

function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function quotePartPayment(f: PartPaymentFacts, on: IsoDate): PartPaymentQuote {
  const days = Math.max(0, daysBetween(f.lastDueDate, on));
  // outstanding × (annual% / 100) × days / 360, then truncate to whole rupees.
  const stubRatio = div(mul(mul(ratio(f.outstandingAfterDueMinor), parseRatio(f.annualPercent)), ratio(days)), ratio(36_000 * 100));
  const stubRupees = Number(stubRatio.num / stubRatio.den);
  const stubMinor = stubRupees * 100;
  const outstanding = f.outstandingAfterDueMinor + stubMinor;
  const principal = Math.min(f.principalAtRollupMinor, outstanding);
  const interest = outstanding - principal;
  return { on, outstandingMinor: outstanding, principalMinor: principal, interestMinor: interest, minimumMinor: interest + 100, maximumMinor: Math.max(0, outstanding - 100) };
}

export interface PartPaymentSplit {
  chargesMinor: number;
  overdueMinor: number;
  interestMinor: number;
  principalMinor: number;
}

/** How a part payment would be applied: interest first, then principal. No charges or overdue on this loan. */
export function splitPartPayment(amountMinor: number, q: PartPaymentQuote): PartPaymentSplit {
  const interest = Math.min(amountMinor, q.interestMinor);
  return { chargesMinor: 0, overdueMinor: 0, interestMinor: interest, principalMinor: amountMinor - interest };
}

export type PartPaymentCheck = { ok: true } | { ok: false; reason: "below_minimum" | "above_maximum"; limitMinor: number };

export function checkPartPayment(amountMinor: number, q: PartPaymentQuote): PartPaymentCheck {
  if (amountMinor < q.minimumMinor) return { ok: false, reason: "below_minimum", limitMinor: q.minimumMinor };
  if (amountMinor > q.maximumMinor) return { ok: false, reason: "above_maximum", limitMinor: q.maximumMinor };
  return { ok: true };
}
