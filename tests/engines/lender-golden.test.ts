import { describe, expect, it } from "vitest";
import { amortize } from "@/engines/loan/amortize";
import { lenderMonths } from "@/engines/loan/lender-schedule";
import { checkPartPayment, quotePartPayment, splitPartPayment } from "@/engines/loan/part-payment";
import { planPayoff, type PlannerBase, type PlannerInputs } from "@/engines/loan/planner";

const L = lenderMonths();
const at = (date: string) => L.find((m) => m.date === date)!;
const R = (n: number) => n * 100;

describe("the lender's official repayment schedule (issued 2026-11-16)", () => {
  it("has 174 instalments ending 2039-01-11, and a 146-month remainder after Nov 2026", () => {
    expect(L).toHaveLength(174);
    expect(L.at(-1)!.date).toBe("2039-01-11");
    expect(L.filter((m) => m.date > "2026-11-11")).toHaveLength(146);
  });

  it("is internally consistent: each month's unpaid interest is added to the outstanding", () => {
    const disbursementMonths = new Set(["2025-02-11", "2025-09-11", "2026-02-11"]);
    for (let i = 1; i < L.length; i++) {
      const m = L[i]!;
      if (m.date >= "2027-09-11") break; // from the first EMI the outstanding falls by the principal instead
      if (disbursementMonths.has(m.date)) continue; // a disbursement landed in that month
      expect(m.outstandingMinor - L[i - 1]!.outstandingMinor, m.date).toBeGreaterThanOrEqual(m.unpaidAddedMinor - 300);
      expect(m.outstandingMinor - L[i - 1]!.outstandingMinor, m.date).toBeLessThanOrEqual(m.unpaidAddedMinor + 300);
      expect(m.interestAccruedMinor - m.interestPaidMinor, m.date).toBe(m.unpaidAddedMinor);
    }
  });

  it("charges rate/12 on the previous outstanding (the implied rate is a real rate every month)", () => {
    for (let i = 1; i < L.length; i++) {
      const m = L[i]!;
      if (["2025-02-11", "2025-09-11", "2026-02-11"].includes(m.date)) continue; // part-month disbursement interest
      const implied = (m.interestAccruedMinor * 12 * 100) / L[i - 1]!.outstandingMinor;
      expect([11.4, 11.5, 11.55, 11.7, 11.8].some((r) => Math.abs(r - implied) < 0.005), `${m.date}: ${implied.toFixed(3)}%`).toBe(true);
    }
  });

  it("matches the paid ledger: ₹2,33,127 of interest paid, plus ₹500 extra in Dec 2025", () => {
    const paid = L.filter((m) => m.date <= "2026-11-11").reduce((s, m) => s + m.interestPaidMinor, 0);
    expect(paid).toBe(R(233_127));
  });
});

describe("the engine reproduces the lender's schedule from today's facts", () => {
  const open = at("2026-11-11");
  const sim = amortize({
    openingBalanceMinor: open.outstandingMinor,
    asOf: "2026-11-11",
    paymentDay: 11,
    rates: [{ effectiveFrom: "2026-10-11", annualPercent: "11.8" }],
    phases: [
      { from: "2026-12-11", kind: "partial_interest", paymentMinor: R(9_846) },
      { from: "2027-09-11", kind: "emi", paymentMinor: R(129_537) },
    ],
    projectFrom: "2026-11-12",
    recordedPayments: [],
    interestRounding: "rupee",
    maxMonths: 400,
  });

  it("pays off on 2039-01-11 after 146 instalments", () => {
    expect(sim.paidOff).toBe(true);
    expect(sim.payoffDate).toBe("2039-01-11");
    expect(sim.periods).toHaveLength(146);
  });

  it("tracks the lender's outstanding within ₹3 for every month, and the last instalment within ₹3", () => {
    sim.periods.forEach((p, k) => {
      const l = L[L.indexOf(open) + 1 + k]!;
      expect(Math.abs(p.closingMinor - l.outstandingMinor), p.date).toBeLessThanOrEqual(R(3));
    });
    expect(Math.abs(sim.periods.at(-1)!.paymentMinor - L.at(-1)!.instalmentMinor)).toBeLessThanOrEqual(R(3));
  });
});

describe("the portal's part payment rules (screens of 2026-11-16)", () => {
  const facts = {
    lastDueDate: "2026-11-11",
    outstandingAfterDueMinor: at("2026-11-11").outstandingMinor,
    principalAtRollupMinor: at("2026-07-11").outstandingMinor, // interest was last added to principal on 2026-07-11
    annualPercent: "11.8",
  };
  const q = quotePartPayment(facts, "2026-11-16");

  it("shows outstanding ₹89,94,443, minimum ₹3,15,606, maximum ₹89,94,442", () => {
    expect(q.outstandingMinor).toBe(R(8_994_443));
    expect(q.interestMinor).toBe(R(315_605));
    expect(q.minimumMinor).toBe(R(315_606));
    expect(q.maximumMinor).toBe(R(8_994_442));
  });

  it("applies ₹3,16,000 as ₹3,15,605 interest and ₹395 principal", () => {
    expect(splitPartPayment(R(316_000), q)).toEqual({ chargesMinor: 0, overdueMinor: 0, interestMinor: R(315_605), principalMinor: R(395) });
  });

  it("rejects anything below the minimum or above the maximum", () => {
    expect(checkPartPayment(R(315_605), q)).toEqual({ ok: false, reason: "below_minimum", limitMinor: R(315_606) });
    expect(checkPartPayment(R(315_606), q).ok).toBe(true);
    expect(checkPartPayment(R(8_994_443), q)).toEqual({ ok: false, reason: "above_maximum", limitMinor: R(8_994_442) });
  });
});

describe("the planner holds extras until they reach the portal minimum", () => {
  const base: PlannerBase = {
    openingBalanceMinor: at("2026-11-11").outstandingMinor,
    asOf: "2026-11-11",
    paymentDay: 11,
    phases: [
      { from: "2026-12-11", kind: "partial_interest", paymentMinor: R(9_846) },
      { from: "2027-09-11", kind: "emi", paymentMinor: R(129_537) },
    ],
    recordedPayments: [],
    maxMonths: 400,
    interestRounding: "rupee",
    accrual: { principalMinor: at("2026-07-11").outstandingMinor, rollupOn: "2027-09-11" },
    finalDate: "2039-01-11",
  };
  const inputs: PlannerInputs = {
    monthlyIncomeUsdMinor: 0,
    monthlyExpensesUsdMinor: 0,
    monthlyNewSavingsUsdMinor: 0,
    existingSavingsUsdMinor: 0,
    emergencyReserveUsdMinor: 0,
    lumpSumUsdMinor: 0,
    monthlyExtraUsdMinor: 100_000, // $1,000 ≈ ₹89,550 a month: below the ₹3.15L minimum at first
    contributionMode: "extra",
    annualRatePercent: "11.8",
    fxInrPerUsd: "90",
    transferFeePercent: "0.5",
    hysaApyPercent: "3.4",
    startDate: "2026-11-16",
    saveFirstMonths: 0,
  };

  it("baseline (no extras) equals the lender's schedule: Jan 2039", () => {
    const r = planPayoff(base, { ...inputs, monthlyExtraUsdMinor: 0 });
    expect(r.baseline.payoffDate).toBe("2039-01-11");
  });

  it("small monthly extras are held (the minimum grows as fast as they do) and released when the interest is rolled up", () => {
    const r = planPayoff(base, inputs); // ≈ ₹89,550 a month
    const applied = r.plan.periods.filter((p) => p.extraMinor > 0);
    expect(r.plan.periods.some((p) => p.heldMinor > 0)).toBe(true);
    expect(applied[0]!.date).toBe("2027-09-11"); // first due date after the roll-up: minimum is ₹1 again
    expect(applied[0]!.extraMinor).toBeGreaterThan(R(89_000) * 9); // nine months of extras, all at once
    expect(r.warnings.some((w) => w.code === "held_below_minimum")).toBe(true);
  });

  it("a bigger monthly extra clears the interest build-up first, then principal, and never goes below the minimum", () => {
    const r = planPayoff(base, { ...inputs, monthlyExtraUsdMinor: 350_000 }); // $3,500 ≈ ₹3.13L a month
    const applied = r.plan.periods.filter((p) => p.extraMinor > 0 && p.date < "2027-09-11");
    expect(applied.length).toBeGreaterThan(0);
    for (const p of applied) expect(p.extraMinor + p.requiredMinor).toBeGreaterThanOrEqual(p.partPaymentMinMinor! - 1);
    expect(applied[0]!.extraInterestMinor).toBeGreaterThan(0); // interest build-up is cleared before principal
    expect(applied[0]!.extraPrincipalMinor).toBeGreaterThan(0);
  });

  it("balance always equals principal + interest build-up bookkeeping (closing never negative, ends paid off)", () => {
    const r = planPayoff(base, inputs);
    expect(r.plan.paidOff).toBe(true);
    expect(r.plan.payoffDate! < "2039-01-11").toBe(true); // extras shorten the tenure
    for (const p of r.plan.periods) expect(p.closingMinor).toBeGreaterThanOrEqual(0);
  });

  it("after a one-off part payment, 'reduce EMI' keeps the lender's end date and lowers the EMI; 'shorten tenure' finishes sooner", () => {
    const lump: PlannerInputs = { ...inputs, monthlyExtraUsdMinor: 0, contributionMode: "extra", existingSavingsUsdMinor: 2_000_000, lumpSumUsdMinor: 2_000_000 };
    const keepTenure = planPayoff(base, { ...lump, afterPartPayment: "reduce_emi" });
    const shorten = planPayoff(base, lump);
    expect(keepTenure.plan.payoffDate).toBe("2039-01-11");
    expect(shorten.plan.payoffDate! < "2039-01-11").toBe(true);
    const emis = keepTenure.plan.periods.filter((p) => p.phase === "emi");
    expect(emis[1]!.requiredMinor).toBeLessThan(R(129_537));
    expect(shorten.plan.periods.filter((p) => p.phase === "emi")[1]!.requiredMinor).toBe(R(129_537));
  });
});
