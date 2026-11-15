/**
 * Closing a month snapshots its rows and category totals. Later changes are detected by
 * diffing the snapshot against freshly derived rows — a closed month is never changed silently.
 */
import { NEEDS_CATEGORY } from "./defaults";
import type { MonthKey } from "./dates";
import type { MonthRow } from "./month";
import { categoryTotals } from "./month";
import type { RowStatus } from "./types";

export interface SnapshotRow {
  key: string;
  date: string;
  description: string;
  category: string;
  costMinor: number;
  shareMinor: number;
  status: RowStatus;
  reasonText: string;
  /** Source fingerprint (e.g. Splitwise updated_at / raw hash). A change here alone is reported too. */
  sourceVersion: string | null;
}

export interface MonthSnapshot {
  version: 1;
  month: MonthKey;
  totalMinor: number;
  categoryTotals: Record<string, number>;
  rows: SnapshotRow[];
}

export function toSnapshotRow(r: MonthRow, sourceVersion: string | null = null): SnapshotRow {
  return {
    key: r.key,
    date: r.date,
    description: r.description,
    category: r.category.category ?? NEEDS_CATEGORY,
    costMinor: r.costMinor,
    shareMinor: r.result.shareMinor,
    status: r.result.status,
    reasonText: r.result.reasonText,
    sourceVersion,
  };
}

export function makeSnapshot(month: MonthKey, rows: MonthRow[], sourceVersions: Map<string, string> = new Map()): MonthSnapshot {
  const totals = categoryTotals(rows);
  const snapRows = rows.map((r) => toSnapshotRow(r, sourceVersions.get(r.key) ?? null)).sort((a, b) => a.key.localeCompare(b.key));
  return {
    version: 1,
    month,
    totalMinor: [...totals.values()].reduce((a, b) => a + b, 0),
    categoryTotals: Object.fromEntries([...totals.entries()].sort(([a], [b]) => a.localeCompare(b))),
    rows: snapRows,
  };
}

export type FieldChange = { field: keyof SnapshotRow; before: unknown; after: unknown };

export interface SnapshotDiff {
  added: SnapshotRow[];
  removed: SnapshotRow[];
  changed: { key: string; before: SnapshotRow; after: SnapshotRow; fields: FieldChange[] }[];
  totalBeforeMinor: number;
  totalAfterMinor: number;
  categoryDeltas: { category: string; beforeMinor: number; afterMinor: number }[];
  hasChanges: boolean;
}

const COMPARED: (keyof SnapshotRow)[] = ["date", "description", "category", "costMinor", "shareMinor", "status", "reasonText", "sourceVersion"];

export function diffSnapshots(before: MonthSnapshot, after: MonthSnapshot): SnapshotDiff {
  const b = new Map(before.rows.map((r) => [r.key, r]));
  const a = new Map(after.rows.map((r) => [r.key, r]));
  const added = after.rows.filter((r) => !b.has(r.key));
  const removed = before.rows.filter((r) => !a.has(r.key));
  const changed: SnapshotDiff["changed"] = [];
  for (const [key, br] of b) {
    const ar = a.get(key);
    if (!ar) continue;
    const fields = COMPARED.filter((f) => br[f] !== ar[f]).map((f) => ({ field: f, before: br[f], after: ar[f] }));
    if (fields.length) changed.push({ key, before: br, after: ar, fields });
  }
  const cats = [...new Set([...Object.keys(before.categoryTotals), ...Object.keys(after.categoryTotals)])].sort();
  const categoryDeltas = cats
    .map((c) => ({ category: c, beforeMinor: before.categoryTotals[c] ?? 0, afterMinor: after.categoryTotals[c] ?? 0 }))
    .filter((d) => d.beforeMinor !== d.afterMinor);
  return {
    added,
    removed,
    changed,
    totalBeforeMinor: before.totalMinor,
    totalAfterMinor: after.totalMinor,
    categoryDeltas,
    hasChanges: added.length + removed.length + changed.length > 0,
  };
}
