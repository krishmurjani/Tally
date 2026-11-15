/** Actual-vs-budget display, e.g. "$21 over · 21% over", "$20 left", "$X unbudgeted", "Not recorded". */
import { formatUSD } from "./money";

export type BudgetStatusKind = "not_recorded" | "over" | "left" | "on_budget" | "unbudgeted" | "no_budget";

export interface BudgetStatus {
  kind: BudgetStatusKind;
  text: string;
  /** "danger" is only used for overspending, and always comes with text. */
  tone: "danger" | "ok" | "neutral";
  /** actual − budget, minor units (null when not recorded). */
  differenceMinor: number | null;
  /** Whole-percent over budget, when over and budget > 0. */
  percentOver: number | null;
}

const money = (m: number) => formatUSD(m, { decimals: "auto" });

/** Round half up a/b to an integer, using integer math. */
function roundDiv(a: number, b: number): number {
  return Math.floor((2 * a + b) / (2 * b));
}

/**
 * @param actualMinor my spend for the period, or null when there is no data at all.
 * @param budgetMinor the budget for the period (0 = no budget).
 */
export function budgetStatus(actualMinor: number | null, budgetMinor: number): BudgetStatus {
  if (actualMinor === null) {
    return { kind: "not_recorded", text: "Not recorded", tone: "neutral", differenceMinor: null, percentOver: null };
  }
  const diff = actualMinor - budgetMinor;
  if (budgetMinor === 0) {
    if (actualMinor > 0) {
      return { kind: "unbudgeted", text: `${money(actualMinor)} unbudgeted`, tone: "neutral", differenceMinor: diff, percentOver: null };
    }
    return { kind: "no_budget", text: "No budget", tone: "neutral", differenceMinor: diff, percentOver: null };
  }
  if (diff > 0) {
    const pct = budgetMinor > 0 ? roundDiv(diff * 100, budgetMinor) : null;
    return {
      kind: "over",
      text: `${money(diff)} over · ${pct}% over`,
      tone: "danger",
      differenceMinor: diff,
      percentOver: pct,
    };
  }
  if (diff === 0) return { kind: "on_budget", text: "On budget", tone: "ok", differenceMinor: 0, percentOver: null };
  return { kind: "left", text: `${money(-diff)} left`, tone: "ok", differenceMinor: diff, percentOver: null };
}
