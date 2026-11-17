import { describe, expect, it } from "vitest";
import { describeSeries, monthlyFixedTotal, monthsBetween, recurringRowsForMonth, type RecurringOverride, type RecurringRule } from "@/engines/recurring";

const rule = (over: Partial<RecurringRule> & { series: string; effectiveFrom: string }): RecurringRule => ({ id: `${over.series}-${over.effectiveFrom}`, name: over.series, category: "Rent", amountMinor: 87500, effectiveTo: null, dayOfMonth: 1, ...over });

describe("describing recurring series", () => {
  const rules = [
    rule({ series: "rent", name: "Rent", effectiveFrom: "2026-08", amountMinor: 87500 }),
    rule({ series: "rent", name: "Rent", effectiveFrom: "2027-01", amountMinor: 95000 }), // a raise
    rule({ series: "iphone", name: "iPhone instalment", category: "Phone", effectiveFrom: "2026-11", effectiveTo: "2027-10", amountMinor: 4166 }), // 12 payments
  ];
  const overrides: RecurringOverride[] = [{ series: "rent", month: "2026-12", amountMinor: null, note: "away" }, { series: "iphone", month: "2027-02", amountMinor: 5000, note: null }];

  it("monthsBetween counts whole months", () => {
    expect(monthsBetween("2026-11", "2027-10")).toBe(11);
    expect(monthsBetween("2026-08", "2026-08")).toBe(0);
  });

  it("uses the version in force, and tells an instalment how far along it is", () => {
    const [phone, rent] = [describeSeries(rules, overrides, "2027-03").find((s) => s.series === "iphone")!, describeSeries(rules, overrides, "2027-03").find((s) => s.series === "rent")!];
    expect(rent).toMatchObject({ status: "active", amountMinor: 95000, endsOn: null, paymentsTotal: null });
    expect(phone).toMatchObject({ status: "active", paymentNumber: 5, paymentsTotal: 12, paymentsLeft: 7, endsOn: "2027-10" });
  });

  it("a skipped month adds nothing; an overridden month uses its own amount", () => {
    const dec = describeSeries(rules, overrides, "2026-12");
    expect(dec.find((s) => s.series === "rent")).toMatchObject({ status: "skipped", baseAmountMinor: 87500 });
    expect(monthlyFixedTotal(dec)).toBe(4166); // rent skipped, phone only
    expect(describeSeries(rules, overrides, "2027-02").find((s) => s.series === "iphone")).toMatchObject({ amountMinor: 5000, baseAmountMinor: 4166 });
  });

  it("before it starts it's upcoming; after it ends it's ended (and the last payment says 12 of 12)", () => {
    expect(describeSeries(rules, [], "2026-09").find((s) => s.series === "iphone")).toMatchObject({ status: "upcoming", paymentNumber: null });
    expect(describeSeries(rules, [], "2027-10").find((s) => s.series === "iphone")).toMatchObject({ status: "active", paymentNumber: 12, paymentsLeft: 0 });
    expect(describeSeries(rules, [], "2027-11").find((s) => s.series === "iphone")).toMatchObject({ status: "ended", paymentNumber: 12, paymentsLeft: 0 });
  });

  it("running series come first, ended ones last", () => {
    const order = describeSeries(rules, [], "2027-11").map((s) => s.series);
    expect(order).toEqual(["rent", "iphone"]);
  });

  it("agrees with the rows a month actually gets", () => {
    for (const month of ["2026-10", "2026-11", "2026-12", "2027-02", "2027-10", "2027-11"]) {
      const rows = recurringRowsForMonth(rules, overrides, month);
      expect(rows.reduce((a, r) => a + r.costMinor, 0), month).toBe(monthlyFixedTotal(describeSeries(rules, overrides, month)));
    }
  });
});
