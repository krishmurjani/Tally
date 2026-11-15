/**
 * Payoff planner — "estimate, not lender ledger".
 * USD amounts are cents; loan amounts are INR paise. Effective INR per USD = fx × (1 − fee%).
 */
import { addMonths, dateInMonth, monthOf, type IsoDate } from "../dates";
import { applyRatio, div, mul, parseRatio, ratio, ratioToNumber, sub, type Ratio } from "../rational";
import { amortize, firstPaymentDate, phaseOn, type AmortizeInput, type AmortizeResult, type ExtraPayment } from "./amortize";

export interface PlannerInputs {
  monthlyIncomeUsdMinor: number;
  monthlyExpensesUsdMinor: number;
  monthlyNewSavingsUsdMinor: number;
  existingSavingsUsdMinor: number;
  emergencyReserveUsdMinor: number;
  lumpSumUsdMinor: number;
  /** Additional monthly contribution to the loan, USD (on top of the scheduled payment). Used in "extra" mode. */
  monthlyExtraUsdMinor: number;
  /**
   * "all_available": everything available each month goes to the loan — the scheduled payment comes out of it
   * and the rest is extra (so the extra shrinks automatically when the EMI starts).
   * "extra": the scheduled payment plus a fixed monthlyExtraUsdMinor. Default "extra".
   */
  contributionMode?: "all_available" | "extra";
  annualRatePercent: string;
  fxInrPerUsd: string;
  transferFeePercent: string;
  hysaApyPercent: string;
  startDate: IsoDate;
  /** Save first for N months in a HYSA, then convert and apply. 0 = off. */
  saveFirstMonths: number;
}

export const PLANNER_DEFAULTS = {
  fxInrPerUsd: "90",
  transferFeePercent: "0.5",
  hysaApyPercent: "3.4",
} as const;

export type PlannerWarning =
  | { code: "lump_exceeds_available"; message: string; requestedUsdMinor: number; allowedUsdMinor: number }
  | { code: "deficit"; message: string; deficitUsdMinor: number }
  | { code: "unaffordable"; message: string; neededUsdMinor: number; availableUsdMinor: number }
  | { code: "negative_amortization"; message: string; months: number }
  | { code: "not_paid_off"; message: string }
  | { code: "reserve_below_zero"; message: string };

export interface FundMonth {
  date: IsoDate;
  openingUsdMinor: number;
  interestUsdMinor: number;
  contributionUsdMinor: number;
  closingUsdMinor: number;
}

export interface SaveFirstResult {
  months: FundMonth[];
  fundAtEndUsdMinor: number;
  totalContributedUsdMinor: number;
  totalInterestUsdMinor: number;
  convertedInrMinor: number;
  appliedOn: IsoDate;
  /** INR not needed because the loan was smaller than the fund. */
  leftoverInrMinor: number;
  /** Reserve after the plan — always equal to the input reserve. */
  reserveUsdMinor: number;
}

export interface PlannerResult {
  availableForLoanUsdMinor: number;
  deficitUsdMinor: number;
  effectiveInrPerUsd: string;
  lumpSumUsdMinor: number;
  lumpSumInrMinor: number;
  /** Extra (beyond the schedule) in the first projected month, INR. */
  monthlyExtraInrMinor: number;
  /** Extra in the first projected month, USD. */
  monthlyExtraUsdMinor: number;
  plan: AmortizeResult;
  baseline: AmortizeResult;
  interestSavedInrMinor: number;
  saveFirst: SaveFirstResult | null;
  warnings: PlannerWarning[];
}

/** fx × (1 − fee/100) as an exact ratio. */
export function effectiveFx(fxInrPerUsd: string, feePercent: string): Ratio {
  return mul(parseRatio(fxInrPerUsd), sub(ratio(1), div(parseRatio(feePercent), ratio(100))));
}

export function ratioToFixed(r: Ratio, places = 4): string {
  const scale = 10n ** BigInt(places);
  const n = (r.num * scale * 2n + r.den) / (2n * r.den);
  const s = n.toString().padStart(places + 1, "0");
  return `${s.slice(0, -places)}.${s.slice(-places)}`.replace(/\.?0+$/, "");
}

/** USD cents → INR paise at the effective rate (1 USD cent × rate = rate paise). */
export function usdToInr(usdMinor: number, fx: Ratio): number {
  return applyRatio(usdMinor, fx);
}

/** HYSA monthly rate from APY: (1 + APY)^(1/12) − 1. Float — estimate only; money stays integer cents. */
export function hysaMonthlyRate(apyPercent: string): number {
  return Math.pow(1 + ratioToNumber(parseRatio(apyPercent)) / 100, 1 / 12) - 1;
}

export function availableForLoan(i: Pick<PlannerInputs, "monthlyIncomeUsdMinor" | "monthlyExpensesUsdMinor" | "monthlyNewSavingsUsdMinor">) {
  const raw = i.monthlyIncomeUsdMinor - i.monthlyExpensesUsdMinor - i.monthlyNewSavingsUsdMinor;
  return { availableUsdMinor: Math.max(0, raw), deficitUsdMinor: Math.max(0, -raw) };
}

/** Schedule facts the planner projects from. */
export type PlannerBase = Omit<AmortizeInput, "extras" | "projectFrom" | "rates"> & { rateEffectiveFrom?: IsoDate };

function baseInput(base: PlannerBase, inputs: PlannerInputs, extras: ExtraPayment[]): AmortizeInput {
  return {
    ...base,
    rates: [{ effectiveFrom: base.rateEffectiveFrom ?? "1900-01-01", annualPercent: inputs.annualRatePercent }],
    projectFrom: inputs.startDate,
    extras,
  };
}

/** Payment dates (the loan's payment day) from the first one on/after startDate. */
function paymentDates(base: PlannerBase, startDate: IsoDate, count: number): IsoDate[] {
  const after = startDate > base.asOf ? startDate : base.asOf;
  let d = dateInMonth(monthOf(after), base.paymentDay);
  if (d < after) d = dateInMonth(addMonths(monthOf(after), 1), base.paymentDay);
  if (d <= base.asOf) d = firstPaymentDate(base.asOf, base.paymentDay);
  const out: IsoDate[] = [];
  for (let k = 0; k < count; k++) out.push(dateInMonth(addMonths(monthOf(d), k), base.paymentDay));
  return out;
}

export function planPayoff(base: PlannerBase, inputs: PlannerInputs): PlannerResult {
  const warnings: PlannerWarning[] = [];
  const fx = effectiveFx(inputs.fxInrPerUsd, inputs.transferFeePercent);
  const { availableUsdMinor, deficitUsdMinor } = availableForLoan(inputs);
  if (deficitUsdMinor > 0) {
    warnings.push({ code: "deficit", message: "Expenses and new savings exceed income — nothing is available for the loan.", deficitUsdMinor });
  }

  const maxLump = Math.max(0, inputs.existingSavingsUsdMinor - inputs.emergencyReserveUsdMinor);
  if (inputs.existingSavingsUsdMinor < inputs.emergencyReserveUsdMinor) {
    warnings.push({ code: "reserve_below_zero", message: "Existing savings are below the emergency reserve — no lump sum is possible." });
  }
  const lumpUsd = Math.min(Math.max(0, inputs.lumpSumUsdMinor), maxLump);
  if (inputs.lumpSumUsdMinor > maxLump) {
    warnings.push({
      code: "lump_exceeds_available",
      message: "Lump sum limited to existing savings minus the emergency reserve.",
      requestedUsdMinor: inputs.lumpSumUsdMinor,
      allowedUsdMinor: maxLump,
    });
  }
  const mode = inputs.contributionMode ?? "extra";
  const fixedExtraUsd = Math.max(0, inputs.monthlyExtraUsdMinor);
  const inrToUsd = div(ratio(1), fx);
  const scheduledInrOn = (d: IsoDate) => phaseOn(base.phases, d)?.paymentMinor ?? 0;
  /** Extra beyond the scheduled payment for the payment due on `d`. */
  const extraUsdOn = (d: IsoDate) => (mode === "extra" ? fixedExtraUsd : Math.max(0, availableUsdMinor - applyRatio(scheduledInrOn(d), inrToUsd)));
  const availableInr = usdToInr(availableUsdMinor, fx);
  // In rupees directly (no USD round trip), so available = scheduled + extra to the paisa.
  const extraInrOn = (d: IsoDate) => (mode === "extra" ? usdToInr(fixedExtraUsd, fx) : Math.max(0, availableInr - scheduledInrOn(d)));
  const lumpInr = usdToInr(lumpUsd, fx);
  const horizon = base.maxMonths ?? 600;

  const baseline = amortize(baseInput(base, inputs, []));
  let extras: ExtraPayment[] = [];
  let saveFirst: SaveFirstResult | null = null;

  if (inputs.saveFirstMonths > 0) {
    const r = hysaMonthlyRate(inputs.hysaApyPercent);
    const dates = paymentDates(base, inputs.startDate, inputs.saveFirstMonths);
    let fund = lumpUsd;
    let contributed = 0;
    let interestTotal = 0;
    const months: FundMonth[] = dates.map((d) => {
      const opening = fund;
      const interest = Math.round(opening * r);
      const contribution = extraUsdOn(d);
      fund = opening + interest + contribution;
      contributed += contribution;
      interestTotal += interest;
      return { date: d, openingUsdMinor: opening, interestUsdMinor: interest, contributionUsdMinor: contribution, closingUsdMinor: fund };
    });
    const appliedOn = dates.at(-1)!;
    const converted = usdToInr(fund, fx);
    const after = dateInMonth(addMonths(monthOf(appliedOn), 1), base.paymentDay);
    extras = [
      { date: appliedOn, amountMinor: converted, label: "Saved fund converted and applied" },
      ...paymentDates(base, after, horizon).map((d) => ({ date: d, amountMinor: extraInrOn(d), label: "Monthly extra" })),
    ].filter((e) => e.amountMinor > 0);
    saveFirst = {
      months,
      fundAtEndUsdMinor: fund,
      totalContributedUsdMinor: contributed,
      totalInterestUsdMinor: interestTotal,
      convertedInrMinor: converted,
      appliedOn,
      leftoverInrMinor: 0,
      reserveUsdMinor: inputs.emergencyReserveUsdMinor,
    };
  } else {
    const dates = paymentDates(base, inputs.startDate, horizon);
    extras = [
      ...(lumpInr > 0 ? [{ date: dates[0]!, amountMinor: lumpInr, label: "Lump sum" }] : []),
      ...dates.map((d) => ({ date: d, amountMinor: extraInrOn(d), label: "Monthly extra" })).filter((e) => e.amountMinor > 0),
    ];
  }

  const plan = amortize(baseInput(base, inputs, extras));
  if (saveFirst) {
    const applied = plan.periods.find((p) => p.date === saveFirst!.appliedOn);
    // If the loan was smaller than the fund, the unused part is leftover (clipped).
    saveFirst.leftoverInrMinor = applied ? Math.min(applied.clippedMinor, saveFirst.convertedInrMinor) : saveFirst.convertedInrMinor;
  }

  // Only months the plan controls (from the start date on); past recorded months aren't actionable.
  const belowInterest = plan.periods.filter((p) => p.date >= inputs.startDate && p.warnings.includes("below_interest")).length;
  if (belowInterest > 0) {
    warnings.push({
      code: "negative_amortization",
      message: `${belowInterest} month(s) from the start date where the payment is below the interest — the balance grows.`,
      months: belowInterest,
    });
  }
  if (!plan.paidOff) warnings.push({ code: "not_paid_off", message: "The loan isn't paid off within the projection horizon." });

  // Affordability: scheduled payment (in USD) + extra vs available.
  const firstProjected = plan.periods.find((p) => p.date >= inputs.startDate && p.requiredSource === "schedule");
  if (firstProjected) {
    const requiredUsd = applyRatio(firstProjected.requiredMinor, div(ratio(1), fx));
    const needed = requiredUsd + (mode === "extra" ? fixedExtraUsd : 0);
    if (needed > availableUsdMinor) {
      warnings.push({
        code: "unaffordable",
        message: "The scheduled payment plus the monthly extra is more than what's available each month.",
        neededUsdMinor: needed,
        availableUsdMinor,
      });
    }
  }

  return {
    availableForLoanUsdMinor: availableUsdMinor,
    deficitUsdMinor,
    effectiveInrPerUsd: ratioToFixed(fx),
    lumpSumUsdMinor: lumpUsd,
    lumpSumInrMinor: lumpInr,
    monthlyExtraInrMinor: extraInrOn(paymentDates(base, inputs.startDate, 1)[0]!),
    monthlyExtraUsdMinor: extraUsdOn(paymentDates(base, inputs.startDate, 1)[0]!),
    plan,
    baseline,
    interestSavedInrMinor: baseline.totalInterestMinor - plan.totalInterestMinor,
    saveFirst,
    warnings,
  };
}

export interface RequiredContribution {
  /** Smallest monthly extra (USD cents) that pays the loan off by the target date, or null if none within bounds. */
  monthlyExtraUsdMinor: number | null;
  affordable: boolean | null;
  availableUsdMinor: number;
}

/** Binary search on the monthly extra (no save-first) so payoff happens on/before targetDate. */
export function requiredMonthlyContribution(base: PlannerBase, inputs: PlannerInputs, targetDate: IsoDate): RequiredContribution {
  const { availableUsdMinor } = availableForLoan(inputs);
  const finishesBy = (extra: number) => {
    const r = planPayoff(base, { ...inputs, contributionMode: "extra", monthlyExtraUsdMinor: extra, saveFirstMonths: 0 });
    return r.plan.paidOff && r.plan.payoffDate! <= targetDate;
  };
  if (finishesBy(0)) return { monthlyExtraUsdMinor: 0, affordable: true, availableUsdMinor };
  // Upper bound: enough to clear the whole balance (plus interest headroom) in one month.
  const fx = effectiveFx(inputs.fxInrPerUsd, inputs.transferFeePercent);
  let hi = applyRatio(base.openingBalanceMinor * 2, div(ratio(1), fx)) + 100;
  if (!finishesBy(hi)) return { monthlyExtraUsdMinor: null, affordable: null, availableUsdMinor };
  let lo = 0;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (finishesBy(mid)) hi = mid;
    else lo = mid;
  }
  return { monthlyExtraUsdMinor: hi, affordable: hi <= availableUsdMinor, availableUsdMinor };
}
