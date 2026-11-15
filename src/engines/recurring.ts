/**
 * Recurring expenses that aren't in Splitwise (Rent, Phone).
 * Each rule belongs to a series; versions have effective-from months so a future change
 * (e.g. moving to Miami) never alters past months. Month-specific overrides allowed.
 * Rows are computed — one per series per month, by construction.
 */
import { compareMonths, dateInMonth, type MonthKey } from "./dates";
import type { LedgerRow } from "./types";
import { formatUSD } from "./money";

export interface RecurringRule {
  id: string;
  /** Stable series name, e.g. "rent". A new version of the same series replaces the old one from its effectiveFrom. */
  series: string;
  name: string;
  category: string;
  amountMinor: number;
  effectiveFrom: MonthKey;
  /** Last month this series applies (inclusive), or null for open-ended. */
  effectiveTo: MonthKey | null;
  dayOfMonth: number;
}

export interface RecurringOverride {
  series: string;
  month: MonthKey;
  /** null = skip this month. */
  amountMinor: number | null;
  note?: string | null;
}

export interface RecurringRow extends LedgerRow {
  category: string;
  series: string;
  ruleId: string;
}

/** The rule version in force for a series in a month (latest effectiveFrom ≤ month). */
export function ruleForMonth(rules: RecurringRule[], series: string, month: MonthKey): RecurringRule | null {
  const candidates = rules
    .filter((r) => r.series === series && compareMonths(r.effectiveFrom, month) <= 0)
    .sort((a, b) => compareMonths(b.effectiveFrom, a.effectiveFrom));
  const r = candidates[0];
  if (!r) return null;
  if (r.effectiveTo && compareMonths(month, r.effectiveTo) > 0) return null;
  return r;
}

export function recurringRowsForMonth(
  rules: RecurringRule[],
  overrides: RecurringOverride[],
  month: MonthKey,
): RecurringRow[] {
  const seriesList = [...new Set(rules.map((r) => r.series))].sort();
  const rows: RecurringRow[] = [];
  for (const series of seriesList) {
    const rule = ruleForMonth(rules, series, month);
    if (!rule) continue;
    const ov = overrides.find((o) => o.series === series && o.month === month);
    if (ov && ov.amountMinor === null) continue;
    const amount = ov ? ov.amountMinor! : rule.amountMinor;
    const derivation = [
      `Recurring "${rule.name}" (rule effective from ${rule.effectiveFrom}${rule.effectiveTo ? ` to ${rule.effectiveTo}` : ""}): ${formatUSD(rule.amountMinor)}`,
    ];
    if (ov) derivation.push(`Overridden for ${month}: ${formatUSD(amount)}${ov.note ? ` — ${ov.note}` : ""}`);
    rows.push({
      key: `recurring:${series}:${month}`,
      source: "recurring",
      date: dateInMonth(month, rule.dayOfMonth),
      description: rule.name,
      sourceCategory: null,
      group: null,
      costMinor: amount,
      currency: "USD",
      category: rule.category,
      series,
      ruleId: rule.id,
      result: { status: "included", reason: "recurring", reasonText: "Recurring", shareMinor: amount, derivation },
    });
  }
  return rows;
}
