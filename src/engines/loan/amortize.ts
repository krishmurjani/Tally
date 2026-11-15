/**
 * Deterministic monthly loan model (an ESTIMATE, not the lender ledger).
 *
 *   monthly rate = annual / 12
 *   interest     = opening balance × monthly rate   (rounded half-up to the paisa, once per month)
 *   payment      = capped at opening + interest      (final-payment clipping)
 *   closing      = max(0, opening + interest − payment)
 *
 * Periods end on the payment day (the 11th). Unpaid interest is added to the balance
 * (capitalized) — whether Credila actually capitalizes is unverified.
 * Payments dated on/before the opening-balance date are assumed to be reflected in it and
 * are never subtracted again; recorded payments after it apply exactly once.
 */
import { addMonths, dateInMonth, monthOf, type IsoDate } from "../dates";
import { div, mul, parseRatio, ratio, roundRatio, type Ratio } from "../rational";
import { paidBetween, type LenderPayment } from "./ledger";

export interface RatePeriod {
  effectiveFrom: IsoDate;
  annualPercent: string; // e.g. "11.55"
}

export interface SchedulePhase {
  /** First payment date this phase applies to. */
  from: IsoDate;
  kind: "partial_interest" | "emi";
  paymentMinor: number;
  label?: string;
}

export interface ExtraPayment {
  date: IsoDate;
  amountMinor: number;
  label: string;
}

export interface AmortizeInput {
  openingBalanceMinor: number;
  asOf: IsoDate;
  paymentDay: number;
  rates: RatePeriod[];
  phases: SchedulePhase[];
  /**
   * Periods whose payment date is before this use RECORDED payments only (actuals).
   * From this date on, the schedule's required payment applies (or a recorded payment, if one exists).
   */
  projectFrom: IsoDate;
  /** Lender ledger. Only paid, non-bounce items count; planned items never do. */
  recordedPayments?: LenderPayment[];
  /** Extra / lump payments, applied in the period that contains their date. */
  extras?: ExtraPayment[];
  maxMonths?: number;
}

export type PeriodWarning = "below_interest" | "no_recorded_payment" | "no_phase";

export interface Period {
  index: number;
  date: IsoDate;
  openingMinor: number;
  annualPercent: string;
  interestMinor: number;
  requiredMinor: number;
  /** Where the required part came from. */
  requiredSource: "schedule" | "recorded";
  extraMinor: number;
  paymentMinor: number;
  /** Amount of the intended payment not needed because the balance ran out (final-payment clipping). */
  clippedMinor: number;
  closingMinor: number;
  phase: SchedulePhase["kind"] | null;
  warnings: PeriodWarning[];
}

export interface AmortizeResult {
  periods: Period[];
  paidOff: boolean;
  payoffDate: IsoDate | null;
  monthsToPayoff: number | null;
  totalInterestMinor: number;
  totalPaidMinor: number;
  finalBalanceMinor: number;
  belowInterestMonths: number;
  hitMaxMonths: boolean;
}

/** Monthly rate as an exact ratio: annualPercent / 100 / 12. */
export function monthlyRate(annualPercent: string): Ratio {
  return div(parseRatio(annualPercent), ratio(1200));
}

export function monthlyInterest(balanceMinor: number, annualPercent: string): number {
  if (balanceMinor <= 0) return 0;
  return Number(roundRatio(mul(ratio(balanceMinor), monthlyRate(annualPercent))));
}

export function rateOn(rates: RatePeriod[], date: IsoDate): string {
  const r = [...rates].filter((x) => x.effectiveFrom <= date).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0];
  if (!r) {
    const earliest = [...rates].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1))[0];
    if (!earliest) throw new Error("No interest rate configured");
    return earliest.annualPercent;
  }
  return r.annualPercent;
}

export function phaseOn(phases: SchedulePhase[], date: IsoDate): SchedulePhase | null {
  return [...phases].filter((p) => p.from <= date).sort((a, b) => (a.from < b.from ? 1 : -1))[0] ?? null;
}

/** First payment date strictly after `asOf`. */
export function firstPaymentDate(asOf: IsoDate, paymentDay: number): IsoDate {
  const sameMonth = dateInMonth(monthOf(asOf), paymentDay);
  return sameMonth > asOf ? sameMonth : dateInMonth(addMonths(monthOf(asOf), 1), paymentDay);
}

export function amortize(input: AmortizeInput): AmortizeResult {
  const maxMonths = input.maxMonths ?? 600;
  const recorded = input.recordedPayments ?? [];
  const extras = input.extras ?? [];
  const periods: Period[] = [];
  let balance = input.openingBalanceMinor;
  let prev = input.asOf;
  let date = firstPaymentDate(input.asOf, input.paymentDay);
  let totalInterest = 0;
  let totalPaid = 0;
  let hitMax = false;

  if (balance < 0) throw new Error("Opening balance can't be negative");

  while (balance > 0) {
    if (periods.length >= maxMonths) {
      hitMax = true;
      break;
    }
    const warnings: PeriodWarning[] = [];
    const annual = rateOn(input.rates, prev);
    const interest = monthlyInterest(balance, annual);
    const phase = phaseOn(input.phases, date);

    // Recorded payments in (prev, date] — applied once. Anything on/before asOf is never included
    // because the first window starts after asOf.
    const rec = paidBetween(recorded, prev, date).reduce((s, p) => s + p.amountMinor, 0);
    let required: number;
    let requiredSource: Period["requiredSource"];
    if (date < input.projectFrom) {
      required = rec;
      requiredSource = "recorded";
      if (rec === 0) warnings.push("no_recorded_payment");
    } else if (rec > 0) {
      required = rec;
      requiredSource = "recorded";
    } else {
      if (!phase) warnings.push("no_phase");
      required = phase?.paymentMinor ?? 0;
      requiredSource = "schedule";
    }
    const extra = date < input.projectFrom ? 0 : extras.filter((e) => e.date > prev && e.date <= date).reduce((s, e) => s + e.amountMinor, 0);
    const intended = required + extra;
    const due = balance + interest;
    const payment = Math.min(intended, due);
    const closing = Math.max(0, due - payment);
    if (payment < interest) warnings.push("below_interest");

    periods.push({
      index: periods.length + 1,
      date,
      openingMinor: balance,
      annualPercent: annual,
      interestMinor: interest,
      requiredMinor: required,
      requiredSource,
      extraMinor: extra,
      paymentMinor: payment,
      clippedMinor: intended - payment,
      closingMinor: closing,
      phase: phase?.kind ?? null,
      warnings,
    });
    totalInterest += interest;
    totalPaid += payment;
    balance = closing;
    prev = date;
    date = dateInMonth(addMonths(monthOf(date), 1), input.paymentDay);
  }

  const paidOff = balance === 0;
  const last = periods.at(-1);
  return {
    periods,
    paidOff,
    payoffDate: paidOff ? (last?.date ?? input.asOf) : null,
    monthsToPayoff: paidOff ? periods.length : null,
    totalInterestMinor: totalInterest,
    totalPaidMinor: totalPaid,
    finalBalanceMinor: balance,
    belowInterestMonths: periods.filter((p) => p.warnings.includes("below_interest")).length,
    hitMaxMonths: hitMax,
  };
}
