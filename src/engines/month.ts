/** Month assembly: categorize rows, flag them, total them, and build the month overview. */
import { categorize, type CategoryResolution, type CategoryRules } from "./categorize";
import { budgetStatus, type BudgetStatus } from "./budget";
import { NEEDS_CATEGORY } from "./defaults";
import type { MonthKey } from "./dates";
import { leftOver } from "./income";
import { hasMyShare, type LedgerRow } from "./types";

export type RowFlag = "large" | "needs_category" | "auto_categorized" | "review";

export interface MonthRow extends LedgerRow {
  category: CategoryResolution;
  flags: RowFlag[];
}

export interface BuildRowsOptions {
  rules: CategoryRules;
  /** row key → manually chosen category */
  overrides?: Map<string, string>;
  /** row key → category fixed by the row (manual/recurring entries) */
  fixedCategories?: Map<string, string>;
  largeThresholdMinor: number;
  /** Categories whose recurring rows are never flagged as large (Rent, Phone). */
  neverFlagRecurring?: boolean;
}

/** Rows with no share of mine are dropped here, before categorizing, flagging or counting. */
export function buildMonthRows(rows: LedgerRow[], opts: BuildRowsOptions): MonthRow[] {
  return rows.filter(hasMyShare).map((r) => {
    const category = categorize(
      {
        description: r.description,
        sourceCategory: r.sourceCategory,
        fixedCategory: opts.fixedCategories?.get(r.key) ?? null,
        manualOverride: opts.overrides?.get(r.key) ?? null,
      },
      opts.rules,
    );
    const flags: RowFlag[] = [];
    if (r.result.status === "review") flags.push("review");
    if (r.result.status === "included") {
      if (!category.category) flags.push("needs_category");
      if (category.autoCategorized) flags.push("auto_categorized");
      const recurringExempt = r.source === "recurring" && (opts.neverFlagRecurring ?? true);
      if (!recurringExempt && r.result.shareMinor >= opts.largeThresholdMinor) flags.push("large");
    }
    return { ...r, category, flags };
  });
}

export interface CategoryTotal {
  category: string;
  actualMinor: number;
  budgetMinor: number;
  status: BudgetStatus;
}

export interface MonthSummary {
  month: MonthKey;
  totalMinor: number;
  byCategory: CategoryTotal[];
  budgetTotalMinor: number;
  budgetStatus: BudgetStatus;
  incomeMinor: number | null;
  leftOverMinor: number | null;
  previousTotalMinor: number | null;
  changeVsPreviousMinor: number | null;
  counts: { included: number; excluded: number; review: number; needsCategory: number; large: number };
}

export interface SummarizeInput {
  month: MonthKey;
  rows: MonthRow[];
  /** category → budget for this month (the month's budget snapshot). */
  budgets: Map<string, number>;
  /** Order to show categories in. Categories with spend but not listed are appended. */
  categoryOrder: string[];
  incomeMinor: number | null;
  previousTotalMinor: number | null;
}

export function categoryTotals(rows: MonthRow[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const r of rows) {
    if (r.result.status !== "included") continue;
    const c = r.category.category ?? NEEDS_CATEGORY;
    totals.set(c, (totals.get(c) ?? 0) + r.result.shareMinor);
  }
  return totals;
}

export function summarizeMonth(input: SummarizeInput): MonthSummary {
  const totals = categoryTotals(input.rows);
  const order = [...input.categoryOrder];
  for (const c of [...totals.keys(), ...input.budgets.keys()]) if (!order.includes(c)) order.push(c);

  const byCategory: CategoryTotal[] = order
    .filter((c) => totals.has(c) || input.budgets.has(c))
    .map((c) => {
      const actual = totals.get(c) ?? 0;
      const budget = input.budgets.get(c) ?? 0;
      return { category: c, actualMinor: actual, budgetMinor: budget, status: budgetStatus(actual, budget) };
    });

  const totalMinor = [...totals.values()].reduce((a, b) => a + b, 0);
  const budgetTotalMinor = [...input.budgets.values()].reduce((a, b) => a + b, 0);
  const lo = leftOver(input.incomeMinor, totalMinor);
  const count = (pred: (r: MonthRow) => boolean) => input.rows.filter(pred).length;

  return {
    month: input.month,
    totalMinor,
    byCategory,
    budgetTotalMinor,
    budgetStatus: budgetStatus(totalMinor, budgetTotalMinor),
    incomeMinor: input.incomeMinor,
    leftOverMinor: lo.leftOverMinor,
    previousTotalMinor: input.previousTotalMinor,
    changeVsPreviousMinor: input.previousTotalMinor === null ? null : totalMinor - input.previousTotalMinor,
    counts: {
      included: count((r) => r.result.status === "included"),
      excluded: count((r) => r.result.status === "excluded"),
      review: count((r) => r.result.status === "review"),
      needsCategory: count((r) => r.flags.includes("needs_category")),
      large: count((r) => r.flags.includes("large")),
    },
  };
}
