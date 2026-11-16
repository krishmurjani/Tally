/**
 * Today's lender-portal figures (outstanding, interest, part-payment minimum and maximum), derived from the
 * schedule facts and the paid ledger. Matches the portal to the rupee as of 2026-11-16.
 */
import { addMonths, dateInMonth, monthOf, type IsoDate } from "../dates";
import { amortize, rateOn, type RatePeriod, type SchedulePhase } from "./amortize";
import type { LenderPayment } from "./ledger";
import { quotePartPayment, type PartPaymentQuote } from "./part-payment";

export interface PortalFacts {
  openingBalanceMinor: number;
  asOf: IsoDate;
  paymentDay: number;
  phases: SchedulePhase[];
  rates: RatePeriod[];
  /** Principal at the last roll-up of unpaid interest. null = the split isn't known (no minimum can be shown). */
  principalAtRollupMinor: number | null;
  rollupOn: IsoDate | null;
  payments: LenderPayment[];
}

export interface PortalView {
  quote: PartPaymentQuote;
  lastDueDate: IsoDate;
  annualPercent: string;
}

export function portalView(f: PortalFacts, today: IsoDate): PortalView | null {
  if (f.principalAtRollupMinor === null) return null;
  const run = amortize({
    openingBalanceMinor: f.openingBalanceMinor,
    asOf: f.asOf,
    paymentDay: f.paymentDay,
    rates: f.rates,
    phases: f.phases,
    projectFrom: "9999-12-31", // only what has actually been paid
    recordedPayments: f.payments,
    interestRounding: "rupee",
    accrual: { principalMinor: f.principalAtRollupMinor, rollupOn: f.rollupOn },
    maxMonths: 600,
  });
  const last = run.periods.filter((p) => p.date <= today).at(-1);
  const lastDueDate = last?.date ?? f.asOf;
  const outstanding = last ? last.closingMinor : f.openingBalanceMinor;
  const principal = last ? last.closingMinor - last.accruedMinor : f.principalAtRollupMinor;
  const annualPercent = rateOn(f.rates, lastDueDate);
  return { quote: quotePartPayment({ lastDueDate, outstandingAfterDueMinor: outstanding, principalAtRollupMinor: principal, annualPercent }, today), lastDueDate, annualPercent };
}

/** The first EMI date: unpaid interest is rolled into principal then (the lender's schedule does this on 2027-09-11). */
export function rollupDate(phases: SchedulePhase[]): IsoDate | null {
  return phases.find((p) => p.kind === "emi")?.from ?? null;
}

/** The lender's final due date from the "YYYY-MM" final payment month. */
export function finalDueDate(finalPaymentMonth: string | null, paymentDay: number): IsoDate | undefined {
  if (!finalPaymentMonth || !/^\d{4}-\d{2}$/.test(finalPaymentMonth)) return undefined;
  return dateInMonth(finalPaymentMonth, paymentDay);
}

export { addMonths, monthOf };
