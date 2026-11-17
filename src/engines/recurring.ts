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

// ---------------------------------------------------------------------------------------------- describing a series

export type SeriesStatus = "active" | "skipped" | "upcoming" | "ended";

export interface SeriesSummary {
  series: string;
  name: string;
  category: string;
  dayOfMonth: number;
  /** What it costs in the viewed month (the override, if any); for upcoming/ended series, its first/last amount. */
  amountMinor: number;
  /** The rule's own amount, ignoring this month's override. */
  baseAmountMinor: number;
  status: SeriesStatus;
  startsOn: MonthKey;
  /** The last month it applies, or null if open-ended. */
  endsOn: MonthKey | null;
  override: { amountMinor: number | null; note: string | null } | null;
  /** For a series with an end (an instalment): which payment this month is, how many in all, and how many remain after it. */
  paymentNumber: number | null;
  paymentsTotal: number | null;
  paymentsLeft: number | null;
  /** Every version, oldest first. */
  versions: RecurringRule[];
}

const monthIndex = (m: MonthKey) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7));
/** Whole months from a to b (b − a). */
export const monthsBetween = (a: MonthKey, b: MonthKey) => monthIndex(b) - monthIndex(a);

/** Every series as it stands in `month`: this month's amount, whether it's running, skipped, not started or finished, and instalment progress. */
export function describeSeries(rules: RecurringRule[], overrides: RecurringOverride[], month: MonthKey): SeriesSummary[] {
  const bySeries = new Map<string, RecurringRule[]>();
  for (const r of rules) bySeries.set(r.series, [...(bySeries.get(r.series) ?? []), r]);
  const out: SeriesSummary[] = [];
  for (const [series, all] of bySeries) {
    const versions = [...all].sort((a, b) => compareMonths(a.effectiveFrom, b.effectiveFrom));
    const first = versions[0]!;
    const last = versions[versions.length - 1]!;
    const inForce = ruleForMonth(rules, series, month);
    const ov = overrides.find((o) => o.series === series && o.month === month) ?? null;
    const startsOn = first.effectiveFrom;
    const endsOn = last.effectiveTo;
    const shown = inForce ?? (compareMonths(month, startsOn) < 0 ? first : last);
    const status: SeriesStatus = inForce ? (ov && ov.amountMinor === null ? "skipped" : "active") : compareMonths(month, startsOn) < 0 ? "upcoming" : "ended";
    const total = endsOn ? monthsBetween(startsOn, endsOn) + 1 : null;
    const number = total !== null && compareMonths(month, startsOn) >= 0 ? Math.min(total, monthsBetween(startsOn, month) + 1) : null;
    out.push({
      series,
      name: shown.name,
      category: shown.category,
      dayOfMonth: shown.dayOfMonth,
      amountMinor: status === "active" && ov && ov.amountMinor !== null ? ov.amountMinor : shown.amountMinor,
      baseAmountMinor: shown.amountMinor,
      status,
      startsOn,
      endsOn,
      override: ov ? { amountMinor: ov.amountMinor, note: ov.note ?? null } : null,
      paymentNumber: number,
      paymentsTotal: total,
      paymentsLeft: total !== null && number !== null ? Math.max(0, total - number) : null,
      versions,
    });
  }
  // Running ones first, then upcoming, skipped, ended; by name within each.
  const rank: Record<SeriesStatus, number> = { active: 0, skipped: 1, upcoming: 2, ended: 3 };
  return out.sort((a, b) => rank[a.status] - rank[b.status] || a.name.localeCompare(b.name));
}

/** What the series add up to in a month (skipped and not-running ones add nothing). */
export function monthlyFixedTotal(summaries: SeriesSummary[]): number {
  return summaries.filter((s) => s.status === "active").reduce((a, s) => a + s.amountMinor, 0);
}
