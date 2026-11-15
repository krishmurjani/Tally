import { describe, expect, it } from "vitest";
import { budgetStatus } from "@/engines/budget";
import { categorize, matchesKeyword } from "@/engines/categorize";
import { diffSnapshots, makeSnapshot } from "@/engines/close";
import { activeDecisionMap, matchDecision, pinDecisions, type DecisionSpec } from "@/engines/decisions";
import { CATEGORY } from "@/engines/defaults";
import { incomeForMonth, leftOver, type IncomeEntry } from "@/engines/income";
import { buildMonthRows } from "@/engines/month";
import { applyDecisions, DEFAULT_RULES } from "@/engines/pipeline";
import { recurringRowsForMonth, type RecurringRule } from "@/engines/recurring";
import type { LedgerRow } from "@/engines/types";

const row = (over: Partial<LedgerRow> & { share?: number }): LedgerRow => {
  const { share = 1000, ...rest } = over;
  return {
    key: "sw:1",
    source: "splitwise",
    date: "2026-08-10",
    description: "Thing",
    sourceCategory: "General",
    group: "18 Battery Ave",
    costMinor: share,
    currency: "USD",
    result: { status: "included", reason: "owed_share", reasonText: "My owed share", shareMinor: share, derivation: [] },
    ...rest,
  };
};

describe("categorize", () => {
  const cat = (description: string, sourceCategory: string | null, manualOverride?: string) =>
    categorize({ description, sourceCategory, manualOverride }, DEFAULT_RULES);

  it("maps confirmed Splitwise categories", () => {
    expect(cat("x", "Heat/gas").category).toBe(CATEGORY.Gas);
    expect(cat("x", "Liquor").category).toBe(CATEGORY.DiningOut);
    expect(cat("x", "Services").category).toBe(CATEGORY.Laundry);
    expect(cat("Internet bill", "TV/Phone/Internet").category).toBe(CATEGORY.WiFi);
  });
  it("TV/Phone/Internet that is clearly a phone bill → Phone", () => {
    expect(cat("T-Mobile phone bill", "TV/Phone/Internet")).toMatchObject({ category: CATEGORY.Phone, autoCategorized: true });
  });
  it("suggested mappings are not applied until confirmed", () => {
    expect(cat("gas", "Gas/fuel")).toMatchObject({ category: null, suggestion: CATEGORY.Transport });
    expect(cat("flight", "Plane").suggestion).toBe(CATEGORY.Travel);
  });
  it.each([
    ["claude", "TV/Phone/Internet"],
    ["Claude Pro", "Utilities - Other"],
    ["Netflix", "Internet"],
  ])("subscription %j filed as %s → Personal (auto)", (d, sw) => {
    expect(cat(d, sw)).toMatchObject({ category: CATEGORY.Personal, source: "subscription", autoCategorized: true });
  });
  it("subscription keywords don't touch other categories or plain internet bills", () => {
    expect(cat("apple cider", "Dining out").category).toBe(CATEGORY.DiningOut);
    expect(cat("Internet bill", "TV/Phone/Internet").category).toBe(CATEGORY.WiFi);
  });
  it("vehicle fuel is never home Gas", () => {
    expect(cat("Shell", "Gas/fuel").suggestion).not.toBe(CATEGORY.Gas);
  });
  it("unknown Splitwise categories need a category", () => {
    expect(cat("x", "Taxes")).toMatchObject({ category: null, suggestion: null });
  });
  it.each(["Dosa Batter (Wee)", "Roti (3), Service Fee", "Roti (5x) Wee", "dosa batter"])("grocery ingredient %j → Groceries (auto)", (d) => {
    expect(cat(d, "Dining out")).toMatchObject({ category: CATEGORY.Groceries, source: "keyword", autoCategorized: true });
  });
  it("matches whole words only and leaves restaurant meals alone", () => {
    expect(matchesKeyword("Rotisserie chicken", "roti")).toBe(false);
    expect(cat("Rotisserie chicken", "Dining out").category).toBe(CATEGORY.DiningOut);
    expect(cat("Chipotle", "Dining out").category).toBe(CATEGORY.DiningOut);
  });
  it("keyword override only applies to dining/food rows", () => {
    expect(cat("roti maker", "Electronics").category).toBe(CATEGORY.Personal);
  });
  it("manual override wins over everything", () => {
    expect(cat("Dosa Batter", "Dining out", "Gifts")).toMatchObject({ category: "Gifts", source: "manual" });
  });
});

describe("Not-an-expense decisions (spec test 2, engine part)", () => {
  const spec: DecisionSpec = { id: "d1", date: "2026-09-01", description: "Varun Gas Refund", costMinor: 19328, group: "18-battery-ave", reason: "Balance adjustment" };
  const cand = (key: string, over: Partial<{ date: string; description: string; costMinor: number; group: string | null }> = {}) => ({
    key,
    date: "2026-09-01",
    description: "Varun Gas Refund",
    costMinor: 19328,
    group: "18 Battery Ave",
    ...over,
  });

  it("pins on a unique date + description + cost (+ group) match", () => {
    expect(matchDecision(spec, [cand("sw:1"), cand("sw:2", { costMinor: 100 })])).toEqual({ specId: "d1", state: "pinned", key: "sw:1" });
  });
  it("stays pending with no match or multiple matches", () => {
    expect(matchDecision(spec, [])).toMatchObject({ state: "pending", why: "no_match" });
    expect(matchDecision(spec, [cand("sw:1"), cand("sw:2")])).toMatchObject({ state: "pending", why: "multiple_matches" });
  });
  it("two specs can't claim the same expense", () => {
    const out = pinDecisions([spec, { ...spec, id: "d2" }], [cand("sw:1")]);
    expect(out.every((o) => o.state === "pending")).toBe(true);
  });
  it("decision is per expense: another refund with similar words stays included", () => {
    const pinned = new Map([["sw:1", "Balance adjustment"]]);
    const rows = applyDecisions(
      [row({ key: "sw:1", description: "Varun Gas Refund" }), row({ key: "sw:2", description: "Varun Gas Refund (Oct)" }), row({ key: "sw:3", description: "Amazon refund" })],
      pinned,
    );
    expect(rows.map((r) => r.result.status)).toEqual(["excluded", "included", "included"]);
    expect(rows[0]!.result.reasonText).toBe("Balance adjustment");
  });
  it("a decision also resolves a needs-review row, but never overrides a rule exclusion", () => {
    const review = row({ key: "csv:r", result: { status: "review", reason: "possible_refund", reasonText: "Possible refund", shareMinor: 0, derivation: [] } });
    const payment = row({ key: "csv:p", result: { status: "excluded", reason: "payment", reasonText: "Settlement/payment", shareMinor: 0, derivation: [] } });
    const out = applyDecisions([review, payment], new Map([["csv:r", "Returned item"], ["csv:p", "x"]]));
    expect(out[0]!.result).toMatchObject({ status: "excluded", reason: "not_an_expense", reasonText: "Returned item" });
    expect(out[1]!.result.reason).toBe("payment");
  });
  it("revoked decisions (undo) no longer apply", () => {
    const m = activeDecisionMap([
      { key: "sw:1", reason: "x", revoked: true },
      { key: "sw:2", reason: "y", revoked: false },
    ]);
    expect([...m.keys()]).toEqual(["sw:2"]);
  });
});

describe("Recurring rent/phone (spec test 8, engine part)", () => {
  const rules: RecurringRule[] = [
    { id: "r1", series: "rent", name: "Rent", category: "Rent", amountMinor: 87500, effectiveFrom: "2026-08", effectiveTo: null, dayOfMonth: 1 },
    { id: "p1", series: "phone", name: "Phone", category: "Phone", amountMinor: 2500, effectiveFrom: "2026-08", effectiveTo: null, dayOfMonth: 1 },
  ];
  it("adds each recurring row exactly once per month", () => {
    const rows = recurringRowsForMonth(rules, [], "2026-09");
    expect(rows.map((r) => r.key)).toEqual(["recurring:phone:2026-09", "recurring:rent:2026-09"]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });
  it("nothing before the effective-from month", () => {
    expect(recurringRowsForMonth(rules, [], "2026-07")).toEqual([]);
  });
  it("a new rule version (moving to Miami) doesn't touch past months", () => {
    const moved = [...rules, { ...rules[0]!, id: "r2", amountMinor: 120000, effectiveFrom: "2027-01" }];
    const amount = (m: string) => recurringRowsForMonth(moved, [], m).find((r) => r.series === "rent")!.result.shareMinor;
    expect(amount("2026-12")).toBe(87500);
    expect(amount("2027-01")).toBe(120000);
    expect(recurringRowsForMonth(moved, [], "2027-02").filter((r) => r.series === "rent")).toHaveLength(1);
  });
  it("month overrides change one month only; null skips it", () => {
    const ov = [
      { series: "rent", month: "2026-10", amountMinor: 50000 },
      { series: "phone", month: "2026-10", amountMinor: null },
    ];
    expect(recurringRowsForMonth(rules, ov, "2026-10").map((r) => [r.series, r.result.shareMinor])).toEqual([["rent", 50000]]);
    expect(recurringRowsForMonth(rules, ov, "2026-11")).toHaveLength(2);
  });
  it("rent/phone recurring rows are never flagged large", () => {
    const built = buildMonthRows(recurringRowsForMonth(rules, [], "2026-09"), {
      rules: DEFAULT_RULES,
      fixedCategories: new Map([["recurring:rent:2026-09", "Rent"], ["recurring:phone:2026-09", "Phone"]]),
      largeThresholdMinor: 10000,
    });
    expect(built.every((r) => !r.flags.includes("large"))).toBe(true);
  });
});

describe("Not-involved rows", () => {
  it("are dropped before categorizing, flagging or counting", () => {
    const notMine = row({ key: "sw:x", result: { status: "excluded", reason: "no_share", reasonText: "", shareMinor: 0, derivation: [] } });
    const built = buildMonthRows([row({ key: "sw:1" }), notMine], { rules: DEFAULT_RULES, largeThresholdMinor: 10000 });
    expect(built.map((r) => r.key)).toEqual(["sw:1"]);
  });
  it("can't be claimed by a decision", () => {
    expect(matchDecision({ id: "d", date: "2026-08-10", description: "Thing", costMinor: 1000, reason: "x" }, [])).toMatchObject({ state: "pending" });
  });
});

describe("Large-expense flag", () => {
  const flags = (share: number) =>
    buildMonthRows([row({ share })], { rules: DEFAULT_RULES, largeThresholdMinor: 10000 })[0]!.flags;
  it("flags my share ≥ threshold", () => {
    expect(flags(10000)).toContain("large");
    expect(flags(9999)).not.toContain("large");
  });
});

describe("Budget display (spec test 9)", () => {
  it("$121 vs $100 → $21 over · 21% over (red)", () => {
    expect(budgetStatus(12100, 10000)).toMatchObject({ text: "$21 over · 21% over", tone: "danger", percentOver: 21 });
  });
  it("$80 vs $100 → $20 left", () => expect(budgetStatus(8000, 10000)).toMatchObject({ text: "$20 left", tone: "ok" }));
  it("budget 0 with spend → $X unbudgeted", () => expect(budgetStatus(865, 0).text).toBe("$8.65 unbudgeted"));
  it("no data → Not recorded", () => expect(budgetStatus(null, 10000).text).toBe("Not recorded"));
  it("exactly on budget", () => expect(budgetStatus(10000, 10000).text).toBe("On budget"));
  it("rounds the percentage half up", () => expect(budgetStatus(10050, 10000).text).toBe("$0.50 over · 1% over"));
});

describe("Income (spec test 10)", () => {
  const e = (id: string, date: string, amountMinor: number): IncomeEntry => ({ id, date, amountMinor, employer: "Acme", note: null });
  const entries = [e("1", "2026-01-02", 250000), e("2", "2026-01-16", 250000), e("3", "2026-01-30", 250000), e("4", "2026-02-13", 250000), e("5", "2026-02-27", 250000)];
  it("3-paycheck month", () => expect(incomeForMonth(entries, "2026-01")).toMatchObject({ totalMinor: 750000, paycheckCount: 3 }));
  it("2-paycheck month", () => expect(incomeForMonth(entries, "2026-02")).toMatchObject({ totalMinor: 500000, paycheckCount: 2 }));
  it("missing income is Not recorded, not $0", () => {
    expect(incomeForMonth(entries, "2026-03").totalMinor).toBeNull();
    expect(leftOver(null, 100000)).toEqual({ leftOverMinor: null, text: "Not recorded" });
  });
  it("a recorded $0 paycheck is $0, not missing", () => {
    expect(incomeForMonth([e("z", "2026-04-10", 0)], "2026-04").totalMinor).toBe(0);
  });
  it("left over = income − expenses", () => expect(leftOver(500000, 182167).leftOverMinor).toBe(317833));
});

describe("Closing a month (spec test 4, engine part)", () => {
  const build = (rows: LedgerRow[]) => buildMonthRows(rows, { rules: DEFAULT_RULES, largeThresholdMinor: 10000 });
  const before = makeSnapshot("2026-08", build([row({ key: "sw:1", share: 1000 }), row({ key: "sw:2", share: 500 })]), new Map([["sw:1", "v1"], ["sw:2", "v1"]]));

  it("no change → no diff", () => {
    const same = makeSnapshot("2026-08", build([row({ key: "sw:2", share: 500 }), row({ key: "sw:1", share: 1000 })]), new Map([["sw:1", "v1"], ["sw:2", "v1"]]));
    expect(diffSnapshots(before, same).hasChanges).toBe(false);
  });
  it("edited, added and deleted expenses are all reported", () => {
    const after = makeSnapshot(
      "2026-08",
      build([
        row({ key: "sw:1", share: 1200 }),
        row({ key: "sw:3", share: 300 }),
        row({ key: "sw:2", share: 500, result: { status: "excluded", reason: "deleted", reasonText: "Deleted in Splitwise", shareMinor: 0, derivation: [] } }),
      ]),
      new Map([["sw:1", "v2"], ["sw:2", "v2"], ["sw:3", "v1"]]),
    );
    const d = diffSnapshots(before, after);
    expect(d.hasChanges).toBe(true);
    expect(d.added.map((r) => r.key)).toEqual(["sw:3"]);
    expect(d.changed.map((c) => c.key).sort()).toEqual(["sw:1", "sw:2"]);
    expect(d.changed.find((c) => c.key === "sw:1")!.fields.map((f) => f.field)).toContain("shareMinor");
    expect(d.totalBeforeMinor).toBe(1500);
    expect(d.totalAfterMinor).toBe(1500);
  });
  it("a source edit that doesn't change amounts is still reported", () => {
    const after = makeSnapshot("2026-08", build([row({ key: "sw:1", share: 1000 }), row({ key: "sw:2", share: 500 })]), new Map([["sw:1", "v2"], ["sw:2", "v1"]]));
    expect(diffSnapshots(before, after).changed.map((c) => c.key)).toEqual(["sw:1"]);
  });
});
