/**
 * Spec test 7 (+ test 6 on real data): reconciliation against Krish's private CSV exports in
 * fixtures/private (gitignored). Skipped — loudly — when those files aren't present.
 * Assertions use totals from the build spec only; no fixture contents live in this file.
 */
import { describe, expect, it } from "vitest";
import { computeCsvMonth } from "@/engines/pipeline";
import { reconcile } from "@/engines/reconcile";
import { monthRange } from "@/engines/dates";
import { fixturesAvailable, loadExports } from "../../scripts/lib/load-exports";
import { allDecisionSpecs, loadLocalDecisions } from "../../scripts/lib/local-decisions";
import { AUGUST_2026, SEPTEMBER_2026 } from "../../scripts/lib/targets";

const available = fixturesAvailable();

describe.skipIf(!available)("August 2026 reconciliation (2026-09-16 exports)", () => {
  const comp = available ? computeCsvMonth(loadExports({ exportDate: "2026-09-16" }), "2026-08") : null;

  it("all seven 2026-09-16 exports parse with no unreadable rows", () => {
    expect(comp!.csv.selection.used).toHaveLength(7);
    expect(comp!.csv.problems).toEqual([]);
  });

  it("total is $1,821.67 including $875 rent + $25 phone, with the spec's category breakdown", () => {
    const report = reconcile(comp!.summary, AUGUST_2026);
    // On failure this prints the discrepancy report (total vs category-allocation) — do not tune rules to pass.
    expect(report).toMatchObject({ outcome: "match", totalDiffMinor: 0, categoryDiffs: [] });
  });

  it("nothing in August is waiting for review or a category", () => {
    expect(comp!.summary.counts.review).toBe(0);
    expect(comp!.summary.counts.needsCategory).toBe(0);
  });

  it("rent and phone are each added exactly once", () => {
    const rec = comp!.rows.filter((r) => r.source === "recurring");
    expect(rec.map((r) => [r.description, r.result.shareMinor])).toEqual([
      ["Phone", 2500],
      ["Rent", 87500],
    ]);
  });

  it("the newer 18-battery-ave export supersedes the older one and August is unchanged", () => {
    const all = computeCsvMonth(loadExports(), "2026-08");
    expect(all.csv.selection.superseded.map((s) => s.export.fileName)).toEqual(["18-battery-ave_2026-09-16_export.csv"]);
    expect(all.summary.totalMinor).toBe(AUGUST_2026.totalMinor);
  });
});

describe.skipIf(!available)("Pairwise combination on real exports (spec test 6)", () => {
  const rows = available ? computeCsvMonth(loadExports({ exportDate: "2026-09-16" }), "2026-08").rows : [];
  const find = (d: string) => rows.filter((r) => r.description.trim().toLowerCase().startsWith(d));

  it("slippers → $0, so it's dropped (not my expense)", () => {
    expect(find("slippers")).toHaveLength(0);
  });

  it.each([
    ["alc + cig", 4867],
    ["our bus cancellation", 921],
  ])("%s → %d cents, appearing once", (desc, cents) => {
    const matches = find(desc);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.result.shareMinor).toBe(cents);
  });
});

describe.skipIf(!available)("September 2026 (exports end mid-month)", () => {
  const comp = available ? computeCsvMonth(loadExports(), "2026-09") : null;

  it("both Varun entries are pinned as Not an expense", () => {
    const pinned = comp!.decisionOutcomes.filter((o) => o.state === "pinned");
    expect(pinned).toHaveLength(2);
    const excluded = comp!.rows.filter((r) => r.result.reason === "not_an_expense");
    expect(excluded.reduce((s, r) => s + r.costMinor, 0)).toBe(35126);
  });

  it("is reported as partial — the full-month target needs a later export or the API", () => {
    expect(comp!.csv.partial.length).toBeGreaterThan(0);
    expect(reconcile(comp!.summary, SEPTEMBER_2026).outcome).toBe("total_differs");
  });
});

describe.skipIf(!available)("October 2026 pre-seeded decision", () => {
  it('"Sent Sept 1" is pinned from the newer 18-battery-ave export', () => {
    const comp = computeCsvMonth(loadExports(), "2026-10");
    expect(comp.decisionOutcomes).toMatchObject([{ state: "pinned" }]);
  });
});

describe.skipIf(!available)("Krish-confirmed decisions and categories across all months", () => {
  const exports = available ? loadExports() : [];
  const specs = available ? allDecisionSpecs() : [];
  const months = monthRange("2025-03", "2026-11").map((m) => computeCsvMonth(exports, m, { decisionSpecs: specs }));

  it("every confirmed decision (spec pre-seeds + local file) pins to exactly one row", () => {
    const outcomes = months.flatMap((c) => c.decisionOutcomes);
    expect(outcomes).toHaveLength(specs.length);
    expect(outcomes.filter((o) => o.state !== "pinned")).toEqual([]);
    expect(loadLocalDecisions().length).toBeGreaterThan(0);
  });

  it("no month has rows left in Needs review", () => {
    expect(months.filter((c) => c.summary.counts.review > 0).map((c) => c.summary.month)).toEqual([]);
  });

  it("subscriptions filed under utility categories land in Personal, never Wi-Fi", () => {
    const subs = months.flatMap((c) => c.rows).filter((r) => r.category.source === "subscription");
    expect(subs.length).toBeGreaterThan(0);
    expect(subs.every((r) => r.category.category === "Personal")).toBe(true);
  });

  it("August is unchanged by the confirmed decisions and subscription rule", () => {
    const aug = months.find((c) => c.summary.month === "2026-08")!;
    expect(reconcile(aug.summary, AUGUST_2026).outcome).toBe("match");
  });
});
