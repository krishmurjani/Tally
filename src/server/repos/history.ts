import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { checkKnownTotals, parseHistoryCsv, type TotalCheck } from "@/engines/history";
import * as schema from "../db/schema";
import { computeLiveMonth, getMonthRecord } from "../month-data";
import type { Owner } from "../owner-core";
import { UserFacingError } from "./errors";
import { loadCategories } from "./rules";

type AnyDb = NodePgDatabase<typeof schema>;

export interface HistoryPreview {
  months: (TotalCheck & { hasDetail: boolean; replaces: boolean; categories: number })[];
  errors: { line: number; message: string }[];
  rowCount: number;
}

/** Dry run: parse, validate against known totals, and say what would happen per month. Writes nothing. */
export async function previewHistory(db: AnyDb, owner: Owner, text: string): Promise<HistoryPreview> {
  const cats = await loadCategories(db, owner);
  const parsed = parseHistoryCsv(text, cats.map((c) => c.name));
  const existing = await db.select({ month: schema.historySummaries.month }).from(schema.historySummaries).where(eq(schema.historySummaries.ownerId, owner.id));
  const existingMonths = new Set(existing.map((e) => e.month));
  const months = [];
  for (const check of checkKnownTotals(parsed.byMonth)) {
    const rec = await getMonthRecord(db, owner, check.month);
    const live = await computeLiveMonth(db, owner, check.month, rec?.dataSource ?? null);
    months.push({ ...check, hasDetail: live.hasData, replaces: existingMonths.has(check.month), categories: parsed.byMonth.get(check.month)!.byCategory.size });
  }
  return { months, errors: parsed.errors, rowCount: parsed.rows.length };
}

/** Import: per month in the file, the previous summary (if any) is replaced, never added to. */
export async function commitHistory(db: AnyDb, owner: Owner, text: string) {
  const cats = await loadCategories(db, owner);
  const parsed = parseHistoryCsv(text, cats.map((c) => c.name));
  if (parsed.errors.length) throw new UserFacingError(`Fix ${parsed.errors.length} problem(s) in the file first — nothing was imported.`);
  if (!parsed.rows.length) throw new UserFacingError("The file has no rows.");
  const id = new Map(cats.map((c) => [c.name, c.id]));
  const batch = randomUUID();
  const months = [...parsed.byMonth.keys()];
  await db.transaction(async (tx) => {
    await tx.delete(schema.historySummaries).where(and(eq(schema.historySummaries.ownerId, owner.id), inArray(schema.historySummaries.month, months)));
    await tx.insert(schema.historySummaries).values(parsed.rows.map((r) => ({ ownerId: owner.id, month: r.month, categoryId: id.get(r.category)!, amountMinor: r.amountMinor, importBatch: batch })));
    await tx.insert(schema.auditLog).values({ ownerId: owner.id, entity: "history_import", entityId: batch, action: "import", before: null, after: { months, rows: parsed.rows.length } });
  });
  return { batch, months: months.length, rows: parsed.rows.length };
}

/** Summary totals per month (category name → minor). */
export async function loadSummaries(db: AnyDb, owner: Owner): Promise<Map<string, Map<string, number>>> {
  const rows = await db
    .select({ month: schema.historySummaries.month, amount: schema.historySummaries.amountMinor, category: schema.categories.name })
    .from(schema.historySummaries)
    .innerJoin(schema.categories, eq(schema.categories.id, schema.historySummaries.categoryId))
    .where(eq(schema.historySummaries.ownerId, owner.id));
  const out = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const m = out.get(r.month) ?? new Map();
    m.set(r.category, r.amount);
    out.set(r.month, m);
  }
  return out;
}
