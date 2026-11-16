import { describe, expect, it } from "vitest";
import { amortize, monthlyInterest, type AmortizeInput } from "@/engines/loan/amortize";
import { countsAsPaid, effectiveStatus, paidTotals, sisterFundedMinor, type LenderPayment } from "@/engines/loan/ledger";
import { availableForLoan, effectiveFx, planPayoff, requiredMonthlyContribution, usdToInr, type PlannerBase, type PlannerInputs } from "@/engines/loan/planner";
import { LOAN_FACTS, RUPEE, SEED_LENDER_PAYMENTS, SEED_PLANNED_PAYMENTS, SEED_REIMBURSEMENTS } from "@/engines/loan/seed";
import { sisterLedger } from "@/engines/loan/sister";

const inr = (r: number) => r * RUPEE;

describe("Seeded loan facts", () => {
  it("disbursements total ₹73,84,970", () => {
    expect(LOAN_FACTS.disbursements.reduce((s, d) => s + d.amountMinor, 0)).toBe(inr(73_84_970));
  });
});

describe("Lender ledger & sister ledger (spec test 11)", () => {
  const all = [...SEED_LENDER_PAYMENTS, ...SEED_PLANNED_PAYMENTS];

  it("sister-paid total is ₹2,13,935", () => {
    expect(sisterFundedMinor(all)).toBe(inr(2_13_935));
  });
  it("the bounce is kept for audit but excluded from totals", () => {
    const bounce = all.find((p) => p.type === "bounce")!;
    expect(bounce.dueDate).toBe("2025-12-11");
    expect(countsAsPaid(bounce)).toBe(false);
    expect(paidTotals(all).bouncedCount).toBe(1);
    const asIfPaid = all.map((p) => (p.type === "bounce" ? { ...p, payer: "sister" as const } : p));
    expect(sisterFundedMinor(asIfPaid)).toBe(inr(2_13_935));
  });
  it("Krish has paid ₹19,692 (Oct + Nov 2026); planned items don't count", () => {
    const t = paidTotals(all);
    expect(t.byPayer.krish).toBe(inr(19_692));
    expect(t.plannedMinor).toBe(inr(9_846) * SEED_PLANNED_PAYMENTS.length);
    expect(SEED_PLANNED_PAYMENTS[0]!.dueDate).toBe("2026-12-11");
    expect(SEED_PLANNED_PAYMENTS.at(-1)!.dueDate).toBe("2027-08-11");
  });
  it("planned → overdue after its due date, still not paid", () => {
    const p = SEED_PLANNED_PAYMENTS[0]!;
    expect(effectiveStatus(p, "2026-12-12")).toBe("overdue");
    expect(countsAsPaid({ ...p, status: "overdue" })).toBe(false);
  });
  it("owed to sister is ₹1,24,433 after the ₹89,502 opening reimbursement", () => {
    const l = sisterLedger(all, SEED_REIMBURSEMENTS);
    expect(l.fundedMinor).toBe(inr(2_13_935));
    expect(l.reimbursedMinor).toBe(inr(89_502));
    expect(l.owedMinor).toBe(inr(1_24_433));
    expect(l.creditMinor).toBe(0);
  });
  it("not-yet-reimbursed payments run Sep 2025 → Sep 2026", () => {
    const l = sisterLedger(all, SEED_REIMBURSEMENTS);
    expect(l.unreimbursed[0]!.payment.dueDate).toBe("2025-09-11");
    expect(l.unreimbursed.at(-1)!.payment.dueDate).toBe("2026-09-11");
    expect(l.unreimbursed.every((u) => u.remainingMinor === u.payment.amountMinor)).toBe(true);
    expect(l.unreimbursed.reduce((s, u) => s + u.remainingMinor, 0)).toBe(inr(1_24_433));
  });
  it("reimbursing her never changes lender totals", () => {
    const before = paidTotals(all);
    const l = sisterLedger(all, [...SEED_REIMBURSEMENTS, { id: "r2", date: "2026-11-01", amountMinor: inr(50_000), kind: "entry" }]);
    expect(paidTotals(all)).toEqual(before);
    expect(l.owedMinor).toBe(inr(74_433));
  });
  it("over-reimbursement becomes a credit, owed never negative", () => {
    const l = sisterLedger(all, [{ id: "x", date: "2026-11-01", amountMinor: inr(2_20_000), kind: "entry" }]);
    expect(l).toMatchObject({ owedMinor: 0, creditMinor: inr(6_065) });
    expect(l.unreimbursed).toEqual([]);
  });
});

const simple = (over: Partial<AmortizeInput> = {}): AmortizeInput => ({
  openingBalanceMinor: 100_000,
  asOf: "2026-01-11",
  paymentDay: 11,
  rates: [{ effectiveFrom: "2000-01-01", annualPercent: "12" }],
  phases: [{ from: "2026-02-11", kind: "emi", paymentMinor: 30_000 }],
  projectFrom: "2026-01-12",
  ...over,
});

describe("Loan engine (spec test 12)", () => {
  it("monthly interest = balance × annual/12, rounded half up to the paisa", () => {
    // ₹88,26,923 × 11.55% / 12 = ₹84,959.133875
    expect(monthlyInterest(inr(88_26_923), "11.55")).toBe(8_495_913);
    expect(monthlyInterest(150, "12")).toBe(2); // 1.5 → 2
  });

  it("zero rate: straight-line payoff", () => {
    const r = amortize(simple({ rates: [{ effectiveFrom: "2000-01-01", annualPercent: "0" }] }));
    expect(r.totalInterestMinor).toBe(0);
    expect(r.monthsToPayoff).toBe(4);
    expect(r.periods.map((p) => p.paymentMinor)).toEqual([30_000, 30_000, 30_000, 10_000]);
  });

  it("zero balance: nothing to pay, paid off immediately", () => {
    const r = amortize(simple({ openingBalanceMinor: 0 }));
    expect(r).toMatchObject({ periods: [], paidOff: true, payoffDate: "2026-01-11", monthsToPayoff: 0, totalInterestMinor: 0 });
  });

  it("final payment is clipped to the remaining balance + interest", () => {
    const r = amortize(simple());
    const last = r.periods.at(-1)!;
    expect(last.closingMinor).toBe(0);
    expect(last.paymentMinor).toBe(last.openingMinor + last.interestMinor);
    expect(last.clippedMinor).toBeGreaterThan(0);
    expect(r.totalPaidMinor).toBe(100_000 + r.totalInterestMinor);
  });

  it("phase change: partial interest, then EMI on its calendar date", () => {
    const r = amortize(
      simple({
        phases: [
          { from: "2026-02-11", kind: "partial_interest", paymentMinor: 500 },
          { from: "2026-05-11", kind: "emi", paymentMinor: 40_000 },
        ],
      }),
    );
    expect(r.periods.slice(0, 4).map((p) => [p.date, p.phase, p.requiredMinor])).toEqual([
      ["2026-02-11", "partial_interest", 500],
      ["2026-03-11", "partial_interest", 500],
      ["2026-04-11", "partial_interest", 500],
      ["2026-05-11", "emi", 40_000],
    ]);
  });

  it("warns when the payment is below interest (negative amortization)", () => {
    const r = amortize(simple({ phases: [{ from: "2026-02-11", kind: "partial_interest", paymentMinor: 500 }], maxMonths: 6 }));
    expect(r.periods[0]!.warnings).toContain("below_interest");
    expect(r.periods[1]!.openingMinor).toBeGreaterThan(r.periods[0]!.openingMinor);
    expect(r.belowInterestMonths).toBe(6);
    expect(r).toMatchObject({ paidOff: false, hitMaxMonths: true });
  });

  it("payments on/before the opening-balance date are never subtracted again", () => {
    const pre: LenderPayment = { id: "p", dueDate: "2026-01-11", paidDate: "2026-01-11", amountMinor: 50_000, payer: "krish", type: "pmii_emi", status: "paid" };
    expect(amortize(simple({ recordedPayments: [pre] }))).toEqual(amortize(simple()));
  });

  it("recorded payments after the opening date apply exactly once (instead of the schedule, not on top)", () => {
    const after: LenderPayment = { id: "a", dueDate: "2026-02-11", paidDate: "2026-02-11", amountMinor: 30_000, payer: "krish", type: "pmii_emi", status: "paid" };
    const r = amortize(simple({ recordedPayments: [after], projectFrom: "2026-03-01" }));
    expect(r.periods[0]).toMatchObject({ requiredMinor: 30_000, requiredSource: "recorded", paymentMinor: 30_000 });
    expect(amortize(simple({ recordedPayments: [after] })).periods[0]!.paymentMinor).toBe(30_000);
  });

  it("planned payments never count as paid", () => {
    const planned: LenderPayment = { id: "pl", dueDate: "2026-02-11", paidDate: null, amountMinor: 99_999, payer: "krish", type: "pmii_emi", status: "planned" };
    const r = amortize(simple({ recordedPayments: [planned], projectFrom: "2026-03-01" }));
    expect(r.periods[0]).toMatchObject({ requiredMinor: 0, requiredSource: "recorded", warnings: expect.arrayContaining(["no_recorded_payment"]) });
  });

  it("rate changes take effect from their date", () => {
    const r = amortize(simple({ rates: [{ effectiveFrom: "2000-01-01", annualPercent: "12" }, { effectiveFrom: "2026-03-01", annualPercent: "0" }] }));
    expect(r.periods[0]!.interestMinor).toBe(1000);
    expect(r.periods[2]!.interestMinor).toBe(0);
  });

  it("seeded schedule: first projected month is negative amortization (₹9,846 < ₹88,301 interest)", () => {
    const s = LOAN_FACTS.schedule;
    const r = amortize({
      openingBalanceMinor: s.openingBalanceMinor,
      asOf: s.asOf,
      paymentDay: s.paymentDay,
      rates: [{ effectiveFrom: LOAN_FACTS.rate.effectiveFrom, annualPercent: LOAN_FACTS.rate.annualPercent }],
      phases: [...s.phases],
      projectFrom: "2026-11-14",
      recordedPayments: [...SEED_LENDER_PAYMENTS, ...SEED_PLANNED_PAYMENTS],
    });
    expect(r.periods[0]).toMatchObject({ date: "2026-12-11", requiredSource: "schedule", paymentMinor: inr(9_846), interestMinor: Math.round((s.openingBalanceMinor * 118) / 12000) });
    expect(r.periods[0]!.warnings).toContain("below_interest");
    expect(r.periods.find((p) => p.date === "2027-09-11")!.phase).toBe("emi");
    expect(r.paidOff).toBe(true);
  });
});

describe("Payoff planner", () => {
  const base: PlannerBase = {
    openingBalanceMinor: inr(10_00_000),
    asOf: "2026-09-11",
    paymentDay: 11,
    phases: [{ from: "2026-10-11", kind: "emi", paymentMinor: inr(20_000) }],
    recordedPayments: [],
    maxMonths: 600,
  };
  const inputs: PlannerInputs = {
    monthlyIncomeUsdMinor: 500_000,
    monthlyExpensesUsdMinor: 200_000,
    monthlyNewSavingsUsdMinor: 50_000,
    existingSavingsUsdMinor: 1_000_000,
    emergencyReserveUsdMinor: 600_000,
    lumpSumUsdMinor: 0,
    monthlyExtraUsdMinor: 0,
    annualRatePercent: "11.55",
    fxInrPerUsd: "90",
    transferFeePercent: "0.5",
    hysaApyPercent: "3.4",
    startDate: "2026-09-12",
    saveFirstMonths: 0,
  };

  it("available = max(0, income − expenses − new savings); deficit shown separately", () => {
    expect(availableForLoan(inputs)).toEqual({ availableUsdMinor: 250_000, deficitUsdMinor: 0 });
    expect(availableForLoan({ ...inputs, monthlyExpensesUsdMinor: 600_000 })).toEqual({ availableUsdMinor: 0, deficitUsdMinor: 150_000 });
  });

  it("effective INR per USD = fx × (1 − fee%)", () => {
    expect(planPayoff(base, inputs).effectiveInrPerUsd).toBe("89.55");
    expect(usdToInr(100, effectiveFx("90", "0.5"))).toBe(8955); // $1 → ₹89.55
  });

  it("extra payments shorten the loan and save interest vs the baseline", () => {
    const r = planPayoff(base, { ...inputs, monthlyExtraUsdMinor: 50_000 });
    expect(r.plan.monthsToPayoff!).toBeLessThan(r.baseline.monthsToPayoff!);
    expect(r.interestSavedInrMinor).toBeGreaterThan(0);
  });

  it("lump sum is limited to existing savings − reserve", () => {
    const r = planPayoff(base, { ...inputs, lumpSumUsdMinor: 900_000 });
    expect(r.lumpSumUsdMinor).toBe(400_000);
    expect(r.warnings.map((w) => w.code)).toContain("lump_exceeds_available");
  });

  it("save-first fund reconciles: lump + contributions + interest; reserve untouched", () => {
    const r = planPayoff(base, { ...inputs, lumpSumUsdMinor: 100_000, monthlyExtraUsdMinor: 20_000, saveFirstMonths: 6 });
    const f = r.saveFirst!;
    expect(f.months).toHaveLength(6);
    expect(f.fundAtEndUsdMinor).toBe(100_000 + f.totalContributedUsdMinor + f.totalInterestUsdMinor);
    expect(f.totalContributedUsdMinor).toBe(120_000);
    expect(f.totalInterestUsdMinor).toBeGreaterThan(0);
    expect(f.reserveUsdMinor).toBe(inputs.emergencyReserveUsdMinor);
    expect(f.convertedInrMinor).toBe(usdToInr(f.fundAtEndUsdMinor, effectiveFx("90", "0.5")));
    // required payments continue during the delay; the fund is applied once, on the last delay month
    const applied = r.plan.periods.filter((p) => p.extraMinor >= f.convertedInrMinor);
    expect(applied.map((p) => p.date)).toEqual([f.appliedOn]);
    expect(r.plan.periods.slice(0, 5).every((p) => p.extraMinor === 0 && p.requiredMinor === inr(20_000))).toBe(true);
  });

  it("save-first leftover when the fund exceeds the loan", () => {
    const tiny = { ...base, openingBalanceMinor: inr(1_000) };
    const r = planPayoff(tiny, { ...inputs, lumpSumUsdMinor: 400_000, saveFirstMonths: 1 });
    expect(r.saveFirst!.leftoverInrMinor).toBeGreaterThan(0);
    expect(r.plan.paidOff).toBe(true);
  });

  it("required monthly contribution to finish by a date, with affordability", () => {
    const req = requiredMonthlyContribution(base, inputs, "2028-09-30");
    expect(req.monthlyExtraUsdMinor).not.toBeNull();
    const check = planPayoff(base, { ...inputs, monthlyExtraUsdMinor: req.monthlyExtraUsdMinor! });
    expect(check.plan.payoffDate! <= "2028-09-30").toBe(true);
    const lessCheck = planPayoff(base, { ...inputs, monthlyExtraUsdMinor: req.monthlyExtraUsdMinor! - 1 });
    expect(lessCheck.plan.payoffDate! > "2028-09-30").toBe(true);
    expect(typeof req.affordable).toBe("boolean");
  });

  it("warns about negative amortization and unaffordable plans", () => {
    const r = planPayoff({ ...base, phases: [{ from: "2026-10-11", kind: "partial_interest", paymentMinor: inr(100) }], maxMonths: 24 }, { ...inputs, monthlyIncomeUsdMinor: 260_000 });
    const codes = r.warnings.map((w) => w.code);
    expect(codes).toContain("negative_amortization");
    expect(codes).toContain("not_paid_off");
  });
});

describe("Planner performance (runs in the browser on slider changes)", () => {
  it("full seeded schedule + required-contribution search finishes quickly", () => {
    const s = LOAN_FACTS.schedule;
    const base: PlannerBase = { openingBalanceMinor: s.openingBalanceMinor, asOf: s.asOf, paymentDay: s.paymentDay, phases: [...s.phases], recordedPayments: [...SEED_LENDER_PAYMENTS], maxMonths: 600 };
    const inputs: PlannerInputs = {
      monthlyIncomeUsdMinor: 600_000,
      monthlyExpensesUsdMinor: 200_000,
      monthlyNewSavingsUsdMinor: 50_000,
      existingSavingsUsdMinor: 1_000_000,
      emergencyReserveUsdMinor: 600_000,
      lumpSumUsdMinor: 200_000,
      monthlyExtraUsdMinor: 100_000,
      annualRatePercent: "11.55",
      fxInrPerUsd: "90",
      transferFeePercent: "0.5",
      hysaApyPercent: "3.4",
      startDate: "2026-11-15",
      saveFirstMonths: 0,
    };
    const t0 = performance.now();
    const plan = planPayoff(base, inputs);
    const req = requiredMonthlyContribution(base, inputs, "2031-12-31");
    const ms = performance.now() - t0;
    expect(plan.plan.paidOff).toBe(true);
    expect(plan.plan.monthsToPayoff!).toBeLessThan(plan.baseline.monthsToPayoff!);
    expect(req.monthlyExtraUsdMinor).not.toBeNull();
    expect(ms).toBeLessThan(1500);
  });
});

describe("Planner scenario", () => {
  it("defaults are valid and use the spec's fx/fee/APY", async () => {
    const { defaultScenario, ScenarioSchema } = await import("@/engines/loan/scenario");
    const s = defaultScenario("2026-11-15", "11.55");
    expect(ScenarioSchema.parse(s)).toMatchObject({ fxInrPerUsd: "90", transferFeePercent: "0.5", hysaApyPercent: "3.4" });
    expect(ScenarioSchema.safeParse({ ...s, annualRatePercent: "abc" }).success).toBe(false);
  });
  it("linked month values are a snapshot; drift is detected, never applied silently", async () => {
    const { defaultScenario, linkDrift, plannerInputs } = await import("@/engines/loan/scenario");
    const s = { ...defaultScenario("2026-11-15", "11.55"), monthlyIncomeUsdMinor: 1, linked: { month: "2026-08", incomeMinor: 250000, expensesMinor: 182167 } };
    expect(plannerInputs(s)).toMatchObject({ monthlyIncomeUsdMinor: 250000, monthlyExpensesUsdMinor: 182167 });
    expect(linkDrift(s.linked, { incomeMinor: 250000, expensesMinor: 182167 }).changed).toBe(false);
    expect(linkDrift(s.linked, { incomeMinor: 250000, expensesMinor: 190000 }).changed).toBe(true);
    expect(plannerInputs(s).monthlyExpensesUsdMinor).toBe(182167);
  });
});

describe("Planner: put everything available toward the loan", () => {
  const base: PlannerBase = {
    openingBalanceMinor: inr(10_00_000),
    asOf: "2026-09-11",
    paymentDay: 11,
    phases: [
      { from: "2026-10-11", kind: "partial_interest", paymentMinor: inr(10_000) },
      { from: "2027-03-11", kind: "emi", paymentMinor: inr(50_000) },
    ],
    recordedPayments: [],
    maxMonths: 600,
  };
  const inputs: PlannerInputs = {
    monthlyIncomeUsdMinor: 300_000,
    monthlyExpensesUsdMinor: 200_000,
    monthlyNewSavingsUsdMinor: 0,
    existingSavingsUsdMinor: 0,
    emergencyReserveUsdMinor: 0,
    lumpSumUsdMinor: 0,
    monthlyExtraUsdMinor: 0,
    annualRatePercent: "12",
    fxInrPerUsd: "90",
    transferFeePercent: "0",
    hysaApyPercent: "3.4",
    startDate: "2026-09-12",
    saveFirstMonths: 0,
  };

  it("each month pays available − scheduled as extra, so the total paid = everything available", () => {
    const r = planPayoff(base, { ...inputs, contributionMode: "all_available" });
    const first = r.plan.periods[0]!;
    // $1,000 available → ₹90,000; scheduled ₹10,000 → extra ₹80,000
    expect(first).toMatchObject({ requiredMinor: inr(10_000), extraMinor: inr(80_000), paymentMinor: inr(90_000) });
    const emi = r.plan.periods.find((p) => p.date === "2027-03-11")!;
    expect(emi).toMatchObject({ requiredMinor: inr(50_000), extraMinor: inr(40_000) }); // extra shrinks when the EMI starts
    expect(r.monthlyExtraUsdMinor).toBe(88_889); // ₹80,000 ÷ 90 = $888.89
    expect(r.plan.monthsToPayoff!).toBeLessThan(r.baseline.monthsToPayoff!);
  });

  it("the fixed-extra mode ignores what's available (old behaviour)", () => {
    const r = planPayoff(base, { ...inputs, contributionMode: "extra", monthlyExtraUsdMinor: 0 });
    expect(r.plan.monthsToPayoff).toBe(r.baseline.monthsToPayoff);
  });

  it("when less is available than the schedule needs: no extra, and an affordability warning", () => {
    const r = planPayoff(base, { ...inputs, monthlyIncomeUsdMinor: 205_000, contributionMode: "all_available" });
    expect(r.plan.periods[0]!.extraMinor).toBe(0);
    const late = planPayoff({ ...base, phases: [{ from: "2026-10-11", kind: "emi", paymentMinor: inr(50_000) }] }, { ...inputs, monthlyIncomeUsdMinor: 205_000, contributionMode: "all_available" });
    expect(late.warnings.map((w) => w.code)).toContain("unaffordable");
  });

  it("save-first puts available − scheduled into the fund each month", () => {
    const r = planPayoff(base, { ...inputs, contributionMode: "all_available", saveFirstMonths: 3 });
    expect(r.saveFirst!.months.map((m) => m.contributionUsdMinor)).toEqual([88_889, 88_889, 88_889]);
    expect(r.plan.periods.slice(0, 2).every((p) => p.extraMinor === 0)).toBe(true);
  });

  it("plans saved before this option default to everything available", async () => {
    const { ScenarioSchema, defaultScenario } = await import("@/engines/loan/scenario");
    const { contributionMode: _m, ...old } = defaultScenario("2026-11-15", "11.55");
    expect(ScenarioSchema.parse(old).contributionMode).toBe("all_available");
  });
});

describe("Planner warnings only cover the plan's own months", () => {
  it("past recorded months below interest don't trigger the negative-amortization warning", () => {
    const s = LOAN_FACTS.schedule;
    const base: PlannerBase = { openingBalanceMinor: s.openingBalanceMinor, asOf: s.asOf, paymentDay: s.paymentDay, phases: [...s.phases], recordedPayments: [...SEED_LENDER_PAYMENTS], maxMonths: 600 };
    const big: PlannerInputs = {
      monthlyIncomeUsdMinor: 800_000, monthlyExpensesUsdMinor: 300_000, monthlyNewSavingsUsdMinor: 0, existingSavingsUsdMinor: 0, emergencyReserveUsdMinor: 0,
      lumpSumUsdMinor: 0, monthlyExtraUsdMinor: 0, annualRatePercent: "11.55", fxInrPerUsd: "90", transferFeePercent: "0.5", hysaApyPercent: "3.4",
      startDate: "2026-11-15", saveFirstMonths: 0, contributionMode: "all_available",
    };
    const r = planPayoff(base, big);
    expect(r.warnings.map((w) => w.code)).not.toContain("negative_amortization");
    expect(r.plan.payoffDate).toBe("2028-10-11");
    const scheduleOnly = planPayoff(base, { ...big, contributionMode: "extra" });
    expect(scheduleOnly.warnings.find((w) => w.code === "negative_amortization")).toMatchObject({ months: 9 }); // Dec 2026 – Aug 2027
  });
});
