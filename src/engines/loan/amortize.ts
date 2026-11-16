/**
 * Deterministic monthly loan model (an ESTIMATE, not the lender ledger).
 *
 *   monthly rate = annual / 12
 *   interest     = opening balance × monthly rate   (rounded half-up to the paisa, once per month)
 *   payment      = capped at opening + interest      (final-payment clipping)
 *   closing      = max(0, opening + interest − payment)
 *
 * Periods end on the payment day (the 11th). Unpaid interest is added to the balance, so interest compounds
 * monthly. This is exactly how Credila's own schedule behaves: checked against the official repayment schedule
 * (every month from Nov 2026 to Jan 2039), see tests/engines/lender-golden.test.ts.
 *
 * Optionally the balance is split into PRINCIPAL and an interest BUILD-UP (accrual). The lender applies any
 * payment to the build-up first, then principal, and its portal only accepts a part payment larger than the
 * build-up. With `accrual` and `holdExtrasBelowMinimum` set, extras smaller than that minimum are held back
 * until they reach it. The build-up is rolled into principal on `rollupOn` (the end of the pre-EMI period).
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

export interface AccrualSplit {
  /** Part of the opening balance that is principal (everything rolled up so far). The rest is interest build-up. */
  principalMinor: number;
  /** The build-up is added to principal on the first due date on/after this. null = never. */
  rollupOn: IsoDate | null;
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
  /** "rupee" = nearest whole rupee, as in the loan agreement (cl. 2.3(b)). Default "paisa". */
  interestRounding?: "paisa" | "rupee";
  accrual?: AccrualSplit;
  /** With `accrual`: an extra below the portal minimum is held (carried) until the pot reaches it. */
  holdExtrasBelowMinimum?: boolean;
  /**
   * "reduce_emi": after part payments the EMI is recalculated each month so the loan still ends on `finalDate`
   * (the portal's "keep tenure same, reduce EMI"). Without it the scheduled EMI stays fixed and payoff comes sooner.
   */
  emiPolicy?: { mode: "reduce_emi"; finalDate: IsoDate };
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
  /** Interest build-up (not yet rolled into principal) after this period. 0 when no accrual split is given. */
  accruedMinor: number;
  /** Smallest part payment the portal would accept at this date (build-up + ₹1). null without an accrual split. */
  partPaymentMinMinor: number | null;
  /** Extras held back so far because they were below the minimum. */
  heldMinor: number;
  /** How the applied extra was split: interest build-up first, then principal. */
  extraInterestMinor: number;
  extraPrincipalMinor: number;
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

export function monthlyInterest(balanceMinor: number, annualPercent: string, rounding: "paisa" | "rupee" = "paisa"): number {
  if (balanceMinor <= 0) return 0;
  const exact = mul(ratio(balanceMinor), monthlyRate(annualPercent));
  if (rounding === "rupee") return Number(roundRatio(div(exact, ratio(100)))) * 100;
  return Number(roundRatio(exact));
}

/** Level instalment (whole rupees, in paise) that clears `balanceMinor` in `periods` payments at `annualPercent`. */
export function levelInstalment(balanceMinor: number, annualPercent: string, periods: number): number {
  if (periods <= 1) return Number.POSITIVE_INFINITY;
  const r = Number(annualPercent) / 1200;
  const pmt = r === 0 ? balanceMinor / periods : (balanceMinor * r) / (1 - Math.pow(1 + r, -periods));
  return Math.round(pmt / 100) * 100;
}

function monthsBetween(from: IsoDate, to: IsoDate): number {
  return (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + (Number(to.slice(5, 7)) - Number(from.slice(5, 7)));
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
  const rounding = input.interestRounding ?? "paisa";
  const recorded = input.recordedPayments ?? [];
  // Extras sorted once and consumed with a cursor: O(periods + extras), not O(periods × extras).
  const extras = [...(input.extras ?? [])].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let extraCursor = 0;
  const periods: Period[] = [];
  let balance = input.openingBalanceMinor;
  // Principal / interest build-up split (only when the caller supplies it).
  const split = input.accrual ?? null;
  let principal = split ? Math.min(split.principalMinor, balance) : balance;
  let accrued = split ? balance - principal : 0;
  let rolled = false;
  let pot = 0; // extras held back below the portal minimum
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
    const interest = monthlyInterest(balance, annual, rounding);
    const phase = phaseOn(input.phases, date);
    // End of the pre-EMI period: the build-up becomes principal (same total, so interest is unchanged).
    if (split && !rolled && split.rollupOn && date >= split.rollupOn) {
      principal += accrued;
      accrued = 0;
      rolled = true;
    }

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
      // "Keep tenure the same": recalculate the EMI so the loan still ends on the lender's final month.
      if (input.emiPolicy && phase?.kind === "emi") {
        const left = monthsBetween(date, input.emiPolicy.finalDate) + 1;
        if (left >= 1) required = Math.min(required, levelInstalment(balance, annual, left));
      }
      requiredSource = "schedule";
    }
    let windowExtras = 0;
    while (extraCursor < extras.length && extras[extraCursor]!.date <= date) {
      if (extras[extraCursor]!.date > prev) windowExtras += extras[extraCursor]!.amountMinor;
      extraCursor++;
    }
    // Extras dated before the projection start are never applied (they'd be recorded payments instead).
    const extraIn = date < input.projectFrom ? 0 : windowExtras;

    const due = balance + interest;
    const requiredPaid = Math.min(required, due);
    // After the instalment, what interest is still unpaid (the portal's "interest" for a part payment).
    const accruedAfterRequired = split ? Math.max(0, accrued + interest - requiredPaid) : 0;
    const minimum = split ? accruedAfterRequired + 100 : null;

    let extra = extraIn;
    if (split && input.holdExtrasBelowMinimum) {
      const available = pot + extraIn;
      if (available > 0 && available >= (minimum ?? 0)) {
        extra = available;
        pot = 0;
      } else {
        extra = 0;
        pot = available;
      }
    }

    const intended = required + extra;
    const payment = Math.min(intended, due);
    const closing = Math.max(0, due - payment);
    if (payment < interest) warnings.push("below_interest");

    // Bookkeeping: the payment clears the interest build-up first, then principal.
    let extraInterest = 0;
    let extraPrincipal = 0;
    if (split) {
      const extraPaid = payment - requiredPaid;
      extraInterest = Math.min(extraPaid, accruedAfterRequired);
      extraPrincipal = extraPaid - extraInterest;
      const buildup = accrued + interest;
      accrued = Math.max(0, buildup - payment);
      principal = principal - Math.max(0, payment - buildup);
      if (closing === 0) {
        principal = 0;
        accrued = 0;
      }
    }

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
      accruedMinor: accrued,
      partPaymentMinMinor: minimum,
      heldMinor: pot,
      extraInterestMinor: extraInterest,
      extraPrincipalMinor: extraPrincipal,
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
