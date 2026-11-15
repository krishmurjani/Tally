/**
 * Assemble a month: source rows (Splitwise API or CSV — never both) + manual expenses + recurring
 * rows → decisions → categories/flags → summary. Closed months are shown from their snapshot.
 * Read-only: this module never writes.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { diffSnapshots, makeSnapshot, type MonthSnapshot, type SnapshotDiff } from "@/engines/close";
import { parseSplitwiseExport, type ParsedExport } from "@/engines/csv/parse";
import { deriveCsvMonth, type CsvMonthResult } from "@/engines/csv/share";
import { addMonths, compareMonths, currentMonthNY, monthBounds, monthOf, monthRange, type MonthKey } from "@/engines/dates";
import type { DecisionCandidate } from "@/engines/decisions";
import { NEEDS_CATEGORY } from "@/engines/defaults";
import { incomeForMonth } from "@/engines/income";
import type { SeriesPoint } from "@/engines/insights";
import { buildMonthRows, categoryTotals, summarizeMonth, summarizeTotals, type MonthRow, type MonthSummary } from "@/engines/month";
import { applyDecisions } from "@/engines/pipeline";
import { recurringRowsForMonth } from "@/engines/recurring";
import { hasMyShare, type LedgerRow } from "@/engines/types";
import * as schema from "./db/schema";
import type { Owner } from "./owner-core";
import { loadDecisions, pinnedMap, type DecisionRecord } from "./repos/decisions";
import { loadSummaries } from "./repos/history";
import { listIncome, type IncomeRecord } from "./repos/income";
import { loadRecurring } from "./repos/recurring";
import { loadBudgets, loadCategories, loadCategoryRules, loadOverrides, type CategoryInfo } from "./repos/rules";

type AnyDb = NodePgDatabase<typeof schema>;

export interface DisplayRow {
  key: string;
  source: LedgerRow["source"];
  date: string;
  description: string;
  group: string | null;
  sourceCategory: string | null;
  costMinor: number;
  currency: string;
  shareMinor: number;
  status: "included" | "excluded" | "review";
  reason: string;
  reasonText: string;
  derivation: string[];
  category: string | null;
  categoryExplanation: string;
  categorySource: string;
  suggestion: string | null;
  flags: string[];
  decision: { id: string; version: number; reason: string | null } | null;
  hasOverride: boolean;
  manual: { id: string; version: number; note: string | null; categoryId: string; amountMinor: number } | null;
  splitwiseId: number | null;
}

export interface MonthView {
  month: MonthKey;
  isCurrentMonth: boolean;
  status: "open" | "closed";
  version: number | null;
  dataSource: "api" | "csv" | null;
  hasData: boolean;
  /** detailed = transactions; summary = imported category totals only; none = nothing recorded. */
  kind: "detailed" | "summary" | "none";
  income: { totalMinor: number | null; entries: IncomeRecord[] };
  rows: DisplayRow[];
  summary: MonthSummary | null;
  budgetSource: "month" | "default" | "snapshot";
  snapshot: MonthSnapshot | null;
  pendingChanges: SnapshotDiff | null;
  pendingDecisions: { id: string; version: number; reason: string | null; spec: NonNullable<DecisionRecord["matchSpec"]> }[];
  categories: CategoryInfo[];
  csv: Pick<CsvMonthResult, "partial" | "problems"> & { files: string[]; superseded: string[] } | null;
  lastSyncAt: Date | null;
}

export async function loadCsvExports(db: AnyDb, owner: Owner): Promise<ParsedExport[]> {
  const files = await db.select().from(schema.csvImports).where(eq(schema.csvImports.ownerId, owner.id));
  return files.map((f) => parseSplitwiseExport(f.fileName, f.content));
}

/** Source rows for a month from Splitwise API rows stored in the DB. */
export async function apiLedgerRows(db: AnyDb, owner: Owner, month: MonthKey): Promise<(LedgerRow & { splitwiseId: number; swUpdatedAt: Date | null })[]> {
  const rows = await db
    .select()
    .from(schema.splitwiseExpenses)
    .where(and(eq(schema.splitwiseExpenses.ownerId, owner.id), eq(schema.splitwiseExpenses.month, month)));
  return rows.map((r) => ({
    key: `sw:${r.splitwiseId}`,
    splitwiseId: r.splitwiseId,
    swUpdatedAt: r.swUpdatedAt,
    source: "splitwise" as const,
    date: r.accountingDate,
    description: r.description,
    sourceCategory: r.swCategory,
    group: r.groupName,
    costMinor: r.costMinor,
    currency: r.currency,
    result: {
      status: r.status,
      reason: r.reason as LedgerRow["result"]["reason"],
      reasonText: r.reasonText,
      shareMinor: r.shareMinor,
      derivation: r.derivation,
    },
  }));
}

export function decisionCandidates(rows: LedgerRow[]): DecisionCandidate[] {
  return rows.filter(hasMyShare).map((r) => ({ key: r.key, date: r.date, description: r.description, costMinor: r.costMinor, group: r.group }));
}

interface LiveMonth {
  rows: MonthRow[];
  displayExtras: Map<string, Partial<DisplayRow>>;
  sourceVersions: Map<string, string>;
  csv: MonthView["csv"];
  hasData: boolean;
  budgets: Map<string, number>;
  budgetSource: "month" | "default";
  decisions: DecisionRecord[];
  categories: CategoryInfo[];
}

/** Live (un-snapshotted) rows for a month. */
export async function computeLiveMonth(db: AnyDb, owner: Owner, month: MonthKey, dataSource: "api" | "csv" | null): Promise<LiveMonth> {
  const [rules, overrides, decisions, recurring, categories, budgetInfo] = await Promise.all([
    loadCategoryRules(db, owner),
    loadOverrides(db, owner),
    loadDecisions(db, owner),
    loadRecurring(db, owner),
    loadCategories(db, owner),
    loadBudgets(db, owner, month),
  ]);
  const [settings] = await db.select({ s: schema.owners.settings }).from(schema.owners).where(eq(schema.owners.id, owner.id));
  const extras = new Map<string, Partial<DisplayRow>>();
  const sourceVersions = new Map<string, string>();

  let source: LedgerRow[] = [];
  let csv: MonthView["csv"] = null;
  if (dataSource === "api") {
    const api = await apiLedgerRows(db, owner, month);
    for (const r of api) {
      extras.set(r.key, { splitwiseId: r.splitwiseId });
      if (r.swUpdatedAt) sourceVersions.set(r.key, r.swUpdatedAt.toISOString());
    }
    source = api;
  } else if (dataSource === "csv") {
    const exports = await loadCsvExports(db, owner);
    if (exports.length) {
      const res = deriveCsvMonth(exports, month);
      source = res.rows;
      csv = {
        partial: res.partial,
        problems: res.problems,
        files: res.selection.used.map((e) => e.fileName),
        superseded: res.selection.superseded.map((s) => s.export.fileName),
      };
    }
  }

  const manual = await db
    .select({ m: schema.manualExpenses, category: schema.categories.name })
    .from(schema.manualExpenses)
    .innerJoin(schema.categories, eq(schema.categories.id, schema.manualExpenses.categoryId))
    .where(and(eq(schema.manualExpenses.ownerId, owner.id), eq(schema.manualExpenses.month, month), isNull(schema.manualExpenses.deletedAt)));
  const fixed = new Map<string, string>();
  const manualRows: LedgerRow[] = manual.map(({ m, category }) => {
    const key = `manual:${m.id}`;
    fixed.set(key, category);
    extras.set(key, { manual: { id: m.id, version: m.version, note: m.note, categoryId: m.categoryId, amountMinor: m.amountMinor } });
    sourceVersions.set(key, `v${m.version}`);
    return {
      key,
      source: "manual",
      date: m.date,
      description: m.description,
      sourceCategory: null,
      group: null,
      costMinor: m.amountMinor,
      currency: "USD",
      result: { status: "included", reason: "manual", reasonText: "Manual expense", shareMinor: m.amountMinor, derivation: ["Entered manually", ...(m.note ? [`Note: ${m.note}`] : [])] },
    };
  });

  const hasData = dataSource !== null || manualRows.length > 0;
  const recurringRows = hasData ? recurringRowsForMonth(recurring.rules, recurring.overrides, month) : [];
  for (const r of recurringRows) fixed.set(r.key, r.category);

  const pinned = pinnedMap(decisions);
  const decided = applyDecisions([...source, ...manualRows, ...recurringRows], new Map([...pinned].map(([k, d]) => [k, d.reason ?? ""])));
  for (const [k, d] of pinned) extras.set(k, { ...extras.get(k), decision: { id: d.id, version: d.version, reason: d.reason } });

  const rows = buildMonthRows(decided, {
    rules,
    overrides: new Map([...overrides].map(([k, o]) => [k, o.categoryName])),
    fixedCategories: fixed,
    largeThresholdMinor: settings?.s.largeExpenseThresholdMinor ?? 10000,
  });
  for (const k of overrides.keys()) extras.set(k, { ...extras.get(k), hasOverride: true });

  return { rows, displayExtras: extras, sourceVersions, csv, hasData, budgets: budgetInfo.budgets, budgetSource: budgetInfo.source, decisions, categories };
}

function toDisplay(r: MonthRow, extra: Partial<DisplayRow> | undefined): DisplayRow {
  return {
    key: r.key,
    source: r.source,
    date: r.date,
    description: r.description,
    group: r.group,
    sourceCategory: r.sourceCategory,
    costMinor: r.costMinor,
    currency: r.currency,
    shareMinor: r.result.shareMinor,
    status: r.result.status,
    reason: r.result.reason,
    reasonText: r.result.reasonText,
    derivation: r.result.derivation,
    category: r.category.category,
    categoryExplanation: r.category.explanation,
    categorySource: r.category.source,
    suggestion: r.category.suggestion,
    flags: r.flags,
    decision: extra?.decision ?? null,
    hasOverride: extra?.hasOverride ?? false,
    manual: extra?.manual ?? null,
    splitwiseId: extra?.splitwiseId ?? null,
  };
}

const sortRows = (a: { date: string; key: string }, b: { date: string; key: string }) =>
  a.date === b.date ? a.key.localeCompare(b.key) : a.date < b.date ? 1 : -1;

export async function getMonthRecord(db: AnyDb, owner: Owner, month: MonthKey) {
  const [m] = await db.select().from(schema.months).where(and(eq(schema.months.ownerId, owner.id), eq(schema.months.month, month)));
  return m ?? null;
}

/** The current live snapshot of a month (what closing it now would freeze). */
export async function liveSnapshot(db: AnyDb, owner: Owner, month: MonthKey, dataSource: "api" | "csv" | null) {
  const live = await computeLiveMonth(db, owner, month, dataSource);
  return { live, snapshot: makeSnapshot(month, live.rows, live.sourceVersions, live.budgets) };
}

/** Total spent in a month, or null when nothing is recorded (used for "change vs previous month"). */
export async function monthTotal(db: AnyDb, owner: Owner, month: MonthKey): Promise<number | null> {
  const rec = await getMonthRecord(db, owner, month);
  if (rec?.status === "closed" && rec.snapshot) return (rec.snapshot as MonthSnapshot).totalMinor;
  const live = await computeLiveMonth(db, owner, month, rec?.dataSource ?? null);
  if (live.hasData) return live.rows.filter((r) => r.result.status === "included").reduce((s, r) => s + r.result.shareMinor, 0);
  const summary = (await loadSummaries(db, owner)).get(month);
  return summary ? [...summary.values()].reduce((a, b) => a + b, 0) : null;
}

export async function loadMonthView(db: AnyDb, owner: Owner, month: MonthKey, now = new Date()): Promise<MonthView> {
  const rec = await getMonthRecord(db, owner, month);
  const dataSource = rec?.dataSource ?? null;
  const live = await computeLiveMonth(db, owner, month, dataSource);
  const previousTotalMinor = await monthTotal(db, owner, addMonths(month, -1));
  const [lastSync] = await db
    .select({ at: schema.syncRuns.finishedAt })
    .from(schema.syncRuns)
    .where(and(eq(schema.syncRuns.ownerId, owner.id), isNull(schema.syncRuns.error)))
    .orderBy(desc(schema.syncRuns.finishedAt))
    .limit(1);

  const categoryOrder = live.categories.map((c) => c.name);
  const { start, end } = monthBounds(month);
  const incomeEntries = await listIncome(db, owner, { from: start, to: end });
  const incomeMinor = incomeForMonth(incomeEntries, month).totalMinor;
  const pendingDecisions = live.decisions
    .filter((d) => d.state === "pending" && d.matchSpec && d.matchSpec.date.startsWith(month))
    .map((d) => ({ id: d.id, version: d.version, reason: d.reason, spec: d.matchSpec! }));
  const base = {
    month,
    isCurrentMonth: compareMonths(month, currentMonthNY(now)) === 0,
    version: rec?.version ?? null,
    dataSource,
    hasData: live.hasData,
    pendingDecisions,
    categories: live.categories,
    csv: live.csv,
    lastSyncAt: lastSync?.at ?? null,
    income: { totalMinor: incomeMinor, entries: incomeEntries },
  };

  if (rec?.status === "closed" && rec.snapshot) {
    const snap = rec.snapshot as MonthSnapshot;
    const liveByKey = new Map(live.rows.map((r) => [r.key, r]));
    const rows: DisplayRow[] = snap.rows
      .map((s) => {
        const l = liveByKey.get(s.key);
        const d = l ? toDisplay(l, live.displayExtras.get(s.key)) : null;
        return {
          ...(d ?? {
            key: s.key,
            source: (s.source as DisplayRow["source"]) ?? "splitwise",
            group: s.group ?? null,
            sourceCategory: null,
            currency: "USD",
            reason: "",
            derivation: ["No longer in the live data — shown as it was when the month closed"],
            categoryExplanation: "",
            categorySource: "snapshot",
            suggestion: null,
            decision: null,
            hasOverride: false,
            manual: null,
            splitwiseId: null,
          }),
          // the snapshot's figures win: a closed month never changes silently
          date: s.date,
          description: s.description,
          costMinor: s.costMinor,
          shareMinor: s.shareMinor,
          status: s.status,
          reasonText: s.reasonText,
          category: s.category === NEEDS_CATEGORY ? null : s.category,
          flags: s.flags ?? [],
        };
      })
      .sort(sortRows);
    const budgets = new Map(Object.entries(snap.budgets ?? {}));
    const count = (p: (r: DisplayRow) => boolean) => rows.filter(p).length;
    const summary = summarizeTotals({
      month,
      totals: new Map(Object.entries(snap.categoryTotals)),
      budgets,
      categoryOrder,
      incomeMinor,
      previousTotalMinor,
      counts: {
        included: count((r) => r.status === "included"),
        excluded: count((r) => r.status === "excluded"),
        review: count((r) => r.status === "review"),
        needsCategory: count((r) => r.flags.includes("needs_category")),
        large: count((r) => r.flags.includes("large")),
      },
    });
    return {
      ...base,
      kind: "detailed",
      status: "closed",
      rows,
      summary,
      budgetSource: "snapshot",
      snapshot: snap,
      pendingChanges: (rec.pendingChanges as SnapshotDiff | null) ?? null,
    };
  }

  if (!live.hasData) {
    const imported = (await loadSummaries(db, owner)).get(month);
    const zero = { included: 0, excluded: 0, review: 0, needsCategory: 0, large: 0 };
    return {
      ...base,
      kind: imported ? "summary" : "none",
      status: "open",
      rows: [],
      summary: imported ? summarizeTotals({ month, totals: imported, budgets: live.budgets, categoryOrder, incomeMinor, previousTotalMinor, counts: zero }) : null,
      budgetSource: live.budgetSource,
      snapshot: null,
      pendingChanges: null,
    };
  }
  const summary = summarizeMonth({ month, rows: live.rows, budgets: live.budgets, categoryOrder, incomeMinor, previousTotalMinor });
  return {
    ...base,
    kind: "detailed",
    status: "open",
    rows: live.rows.map((r) => toDisplay(r, live.displayExtras.get(r.key))).sort(sortRows),
    summary,
    budgetSource: live.budgetSource,
    snapshot: null,
    pendingChanges: null,
  };
}

/** Diff between a closed month's snapshot and what the live data says now. */
export async function closedMonthDiff(db: AnyDb, owner: Owner, month: MonthKey): Promise<SnapshotDiff | null> {
  const rec = await getMonthRecord(db, owner, month);
  if (rec?.status !== "closed" || !rec.snapshot) return null;
  const { snapshot } = await liveSnapshot(db, owner, month, rec.dataSource);
  return diffSnapshots(rec.snapshot as MonthSnapshot, snapshot);
}

/**
 * One point per month that has data (detailed or imported summary), oldest first.
 * Months with nothing recorded are absent — never zero.
 */
export async function monthlySeries(db: AnyDb, owner: Owner, now = new Date()): Promise<SeriesPoint[]> {
  const current = currentMonthNY(now);
  const [summaries, monthRecs, income, manual] = await Promise.all([
    loadSummaries(db, owner),
    db.select().from(schema.months).where(eq(schema.months.ownerId, owner.id)),
    listIncome(db, owner),
    db.select({ month: schema.manualExpenses.month }).from(schema.manualExpenses).where(and(eq(schema.manualExpenses.ownerId, owner.id), isNull(schema.manualExpenses.deletedAt))),
  ]);
  const candidates = [...summaries.keys(), ...monthRecs.map((m) => m.month), ...manual.map((m) => m.month), ...income.map((i) => monthOf(i.date))].filter((m) => compareMonths(m, current) <= 0);
  if (!candidates.length) return [];
  const first = candidates.sort()[0]!;
  const recs = new Map(monthRecs.map((m) => [m.month, m]));
  const out: SeriesPoint[] = [];
  for (const month of monthRange(first, current)) {
    const rec = recs.get(month);
    const incomeMinor = incomeForMonth(income, month).totalMinor;
    let totals: Map<string, number> | null = null;
    let kind: SeriesPoint["kind"] = "detailed";
    let partial = month === current;
    if (rec?.status === "closed" && rec.snapshot) {
      totals = new Map(Object.entries((rec.snapshot as MonthSnapshot).categoryTotals));
    } else {
      const live = await computeLiveMonth(db, owner, month, rec?.dataSource ?? null);
      if (live.hasData) {
        totals = categoryTotals(live.rows);
        if (live.csv?.partial.some((p) => p.coverage === "mtd")) partial = true;
      } else if (summaries.has(month)) {
        totals = summaries.get(month)!;
        kind = "summary";
      }
    }
    if (!totals && incomeMinor === null) continue;
    out.push({
      month,
      kind,
      totalMinor: totals ? [...totals.values()].reduce((a, b) => a + b, 0) : 0,
      byCategory: Object.fromEntries(totals ?? []),
      incomeMinor,
      partial,
      hasSpending: totals !== null,
    });
  }
  return out;
}
