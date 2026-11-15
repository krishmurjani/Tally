/** Insights math (pure). Months without data are absent, never zero. */
import type { MonthKey } from "./dates";

export interface CategoryChange {
  category: string;
  previousMinor: number;
  currentMinor: number;
  changeMinor: number;
  /** Whole percent change; null when last month was 0 ("New"). */
  percent: number | null;
  label: string;
}

/** Round half away from zero to a whole percent, integer math. */
function pct(change: number, base: number): number {
  const q = Math.floor((Math.abs(change) * 200 + base) / (2 * base));
  return change < 0 ? -q : q;
}

/** Biggest category changes vs last month. If last month was 0 → "New", no percentage. */
export function categoryChanges(current: Map<string, number>, previous: Map<string, number>, limit = 5): CategoryChange[] {
  const cats = new Set([...current.keys(), ...previous.keys()]);
  return [...cats]
    .map((category) => {
      const cur = current.get(category) ?? 0;
      const prev = previous.get(category) ?? 0;
      const change = cur - prev;
      const percent = prev > 0 ? pct(change, prev) : null;
      const label = prev === 0 && cur !== 0 ? "New" : percent === null ? "—" : `${percent > 0 ? "+" : ""}${percent}%`;
      return { category, previousMinor: prev, currentMinor: cur, changeMinor: change, percent, label };
    })
    .filter((c) => c.changeMinor !== 0)
    .sort((a, b) => Math.abs(b.changeMinor) - Math.abs(a.changeMinor) || a.category.localeCompare(b.category))
    .slice(0, limit);
}

export type SeriesKind = "detailed" | "summary";

export interface SeriesPoint {
  month: MonthKey;
  kind: SeriesKind;
  totalMinor: number;
  byCategory: Record<string, number>;
  incomeMinor: number | null;
  /** Month-to-date (current month) or built from exports that end mid-month. */
  partial: boolean;
  /** False when only income is recorded for the month (spending "Not recorded"). */
  hasSpending: boolean;
}
