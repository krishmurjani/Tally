/**
 * End-to-end month computation from CSV exports (used by the fixture tests, the reconcile
 * script and the CSV-import fallback). Pure: callers pass parsed exports and settings in.
 */
import type { CategoryRules } from "./categorize";
import { deriveCsvMonth, type CsvMonthResult } from "./csv/share";
import type { ParsedExport } from "./csv/parse";
import type { MonthKey } from "./dates";
import { pinDecisions, type DecisionSpec, type PinOutcome } from "./decisions";
import {
  CONFIRMED_SPLITWISE_MAP,
  DEFAULT_BUDGETS,
  DEFAULT_GROCERY_KEYWORDS,
  DEFAULT_LARGE_EXPENSE_THRESHOLD_MINOR,
  DEFAULT_PHONE_BILL_KEYWORDS,
  DEFAULT_RECURRING,
  DEFAULT_SUBSCRIPTION_KEYWORDS,
  PRESEEDED_DECISIONS,
  SUGGESTED_SPLITWISE_MAP,
} from "./defaults";
import { buildMonthRows, summarizeMonth, type MonthRow, type MonthSummary } from "./month";
import { recurringRowsForMonth, type RecurringOverride, type RecurringRule } from "./recurring";
import { REASON_TEXT, type LedgerRow } from "./types";

export const DEFAULT_RULES: CategoryRules = {
  confirmed: CONFIRMED_SPLITWISE_MAP,
  suggested: SUGGESTED_SPLITWISE_MAP,
  groceryKeywords: DEFAULT_GROCERY_KEYWORDS,
  phoneBillKeywords: DEFAULT_PHONE_BILL_KEYWORDS,
  subscriptionKeywords: DEFAULT_SUBSCRIPTION_KEYWORDS,
};

export const DEFAULT_RECURRING_RULES: RecurringRule[] = DEFAULT_RECURRING.map((r) => ({
  id: `seed-${r.name.toLowerCase()}`,
  series: r.name.toLowerCase(),
  name: r.name,
  category: r.category,
  amountMinor: r.amountMinor,
  effectiveFrom: r.effectiveFrom,
  effectiveTo: null,
  dayOfMonth: r.dayOfMonth,
}));

export const PRESEEDED_DECISION_SPECS: DecisionSpec[] = PRESEEDED_DECISIONS.map((d, i) => ({
  id: `preseed-${i + 1}`,
  date: d.date,
  description: d.description,
  costMinor: d.costMinor,
  group: d.group,
  reason: d.reason,
}));

export interface CsvMonthOptions {
  rules?: CategoryRules;
  recurringRules?: RecurringRule[];
  recurringOverrides?: RecurringOverride[];
  decisionSpecs?: DecisionSpec[];
  overrides?: Map<string, string>;
  largeThresholdMinor?: number;
  budgets?: Map<string, number>;
  incomeMinor?: number | null;
  previousTotalMinor?: number | null;
}

export interface CsvMonthComputation {
  csv: CsvMonthResult;
  decisionOutcomes: PinOutcome[];
  rows: MonthRow[];
  summary: MonthSummary;
}

/**
 * Apply pinned decisions: an included or needs-review row with a decision becomes excluded "Not an expense".
 * Rows already excluded by a rule (payment, settle-all, …) keep their rule reason.
 */
export function applyDecisions(rows: LedgerRow[], pinned: Map<string, string>): LedgerRow[] {
  return rows.map((r) => {
    const reason = pinned.get(r.key);
    if (reason === undefined || r.result.status === "excluded") return r;
    return {
      ...r,
      result: {
        status: "excluded",
        reason: "not_an_expense",
        reasonText: reason || REASON_TEXT.not_an_expense,
        shareMinor: 0,
        derivation: [...r.result.derivation, `saved "Not an expense" decision: ${reason}`],
      },
    };
  });
}

export function computeCsvMonth(exports: ParsedExport[], month: MonthKey, opts: CsvMonthOptions = {}): CsvMonthComputation {
  const csv = deriveCsvMonth(exports, month);
  const specs = (opts.decisionSpecs ?? PRESEEDED_DECISION_SPECS).filter((s) => s.date.startsWith(month));
  const outcomes = pinDecisions(
    specs,
    csv.rows.map((r) => ({ key: r.key, date: r.date, description: r.description, costMinor: r.costMinor, group: r.group })),
  );
  const pinned = new Map<string, string>();
  for (const o of outcomes) {
    if (o.state === "pinned") pinned.set(o.key, specs.find((s) => s.id === o.specId)!.reason);
  }
  const recurring = recurringRowsForMonth(opts.recurringRules ?? DEFAULT_RECURRING_RULES, opts.recurringOverrides ?? [], month);
  const fixed = new Map(recurring.map((r) => [r.key, r.category]));
  const rows = buildMonthRows([...applyDecisions(csv.rows, pinned), ...recurring], {
    rules: opts.rules ?? DEFAULT_RULES,
    overrides: opts.overrides,
    fixedCategories: fixed,
    largeThresholdMinor: opts.largeThresholdMinor ?? DEFAULT_LARGE_EXPENSE_THRESHOLD_MINOR,
  });
  const budgets = opts.budgets ?? new Map(DEFAULT_BUDGETS.map((b) => [b.name, b.budgetMinor]));
  const summary = summarizeMonth({
    month,
    rows,
    budgets,
    categoryOrder: DEFAULT_BUDGETS.map((b) => b.name),
    incomeMinor: opts.incomeMinor ?? null,
    previousTotalMinor: opts.previousTotalMinor ?? null,
  });
  return { csv, decisionOutcomes: outcomes, rows, summary };
}
