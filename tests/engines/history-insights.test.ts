import { describe, expect, it } from "vitest";
import { checkKnownTotals, KNOWN_HISTORY_TOTALS, parseHistoryCsv } from "@/engines/history";
import { categoryChanges } from "@/engines/insights";

const CATS = ["Rent", "Groceries", "Dining Out", "Trip - Miami"];

describe("history summary import", () => {
  it("parses month, category, amount exactly, case-insensitive category names", () => {
    const p = parseHistoryCsv("month,category,amount\n2025-05,Rent,875\n2025-05,groceries,120.5\n2025-05,\"Trip - Miami\",459.43\n", CATS);
    expect(p.errors).toEqual([]);
    expect(p.rows.map((r) => [r.category, r.amountMinor])).toEqual([
      ["Rent", 87500],
      ["Groceries", 12050],
      ["Trip - Miami", 45943],
    ]);
    expect(p.byMonth.get("2025-05")!.totalMinor).toBe(145493);
  });

  it("validates totals against the spec's known month totals", () => {
    const p = parseHistoryCsv("month,category,amount\n2025-05,Rent,1454.93\n2025-06,Rent,1331.78\n2024-12,Rent,10", CATS);
    expect(checkKnownTotals(p.byMonth)).toEqual([
      { month: "2024-12", totalMinor: 1000, knownMinor: null, matches: null },
      { month: "2025-05", totalMinor: 145493, knownMinor: 145493, matches: true },
      { month: "2025-06", totalMinor: 133178, knownMinor: 133179, matches: false },
    ]);
  });

  it("reports bad rows instead of guessing", () => {
    const p = parseHistoryCsv("Month,Category,Amount\nMay 2025,Rent,1\n2025-05,Rnet,1\n2025-05,Rent,1.234\n2025-05,Rent,1\n2025-05,Rent,2\n", CATS);
    expect(p.errors.map((e) => e.line)).toEqual([2, 3, 4, 6]);
    expect(p.rows).toHaveLength(1);
  });

  it("requires the three columns", () => {
    expect(parseHistoryCsv("date,amount\n", CATS).errors[0]!.message).toMatch(/month/);
  });

  it("known totals cover May 2025 – Jul 2026", () => {
    expect(Object.keys(KNOWN_HISTORY_TOTALS)).toHaveLength(15);
    expect(KNOWN_HISTORY_TOTALS["2026-07"]).toBe(170481);
  });
});

describe("biggest category changes", () => {
  it("sorts by size of change, labels New when last month was 0, no %", () => {
    const cur = new Map([["Dining Out", 22557], ["Gifts", 24602], ["Rent", 87500], ["Groceries", 10000]]);
    const prev = new Map([["Dining Out", 10000], ["Rent", 87500], ["Groceries", 12000]]);
    const c = categoryChanges(cur, prev);
    expect(c.map((x) => [x.category, x.label])).toEqual([
      ["Gifts", "New"],
      ["Dining Out", "+126%"],
      ["Groceries", "-17%"],
    ]);
    expect(c[0]!.percent).toBeNull();
  });
});
