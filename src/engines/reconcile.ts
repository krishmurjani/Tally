/**
 * Compare an engine result to a known target. Never used to tune rules — only to report.
 * Distinguishes a total difference from a category-allocation difference (same total, money
 * landed in different categories).
 */
import type { MonthSummary } from "./month";

export interface ReconcileTarget {
  totalMinor: number;
  byCategory?: Record<string, number>;
}

export interface CategoryDiff {
  category: string;
  expectedMinor: number;
  actualMinor: number;
  diffMinor: number;
}

export interface ReconcileReport {
  outcome: "match" | "allocation_only" | "total_differs";
  expectedTotalMinor: number;
  actualTotalMinor: number;
  totalDiffMinor: number;
  categoryDiffs: CategoryDiff[];
}

export function reconcile(summary: MonthSummary, target: ReconcileTarget): ReconcileReport {
  const actual = new Map(summary.byCategory.map((c) => [c.category, c.actualMinor]));
  const cats = new Set([...Object.keys(target.byCategory ?? {}), ...(target.byCategory ? [...actual.keys()] : [])]);
  const categoryDiffs: CategoryDiff[] = [...cats]
    .map((c) => {
      const e = target.byCategory?.[c] ?? 0;
      const a = actual.get(c) ?? 0;
      return { category: c, expectedMinor: e, actualMinor: a, diffMinor: a - e };
    })
    .filter((d) => d.diffMinor !== 0);
  const totalDiffMinor = summary.totalMinor - target.totalMinor;
  return {
    outcome: totalDiffMinor !== 0 ? "total_differs" : categoryDiffs.length ? "allocation_only" : "match",
    expectedTotalMinor: target.totalMinor,
    actualTotalMinor: summary.totalMinor,
    totalDiffMinor,
    categoryDiffs,
  };
}
