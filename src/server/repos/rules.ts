import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { CategoryRules } from "@/engines/categorize";
import { compareMonths, type MonthKey } from "@/engines/dates";
import * as schema from "../db/schema";
import type { Owner } from "../owner-core";

type AnyDb = NodePgDatabase<typeof schema>;

export interface CategoryInfo {
  id: string;
  name: string;
  kind: "builtin" | "custom";
  sortOrder: number;
}

export async function loadCategories(db: AnyDb, owner: Owner): Promise<CategoryInfo[]> {
  const rows = await db
    .select()
    .from(schema.categories)
    .where(and(eq(schema.categories.ownerId, owner.id), eq(schema.categories.archived, false)));
  return rows
    .map((r) => ({ id: r.id, name: r.name, kind: r.kind, sortOrder: r.sortOrder }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

export async function loadCategoryRules(db: AnyDb, owner: Owner): Promise<CategoryRules> {
  const cats = await db.select().from(schema.categories).where(eq(schema.categories.ownerId, owner.id));
  const name = new Map(cats.map((c) => [c.id, c.name]));
  const maps = await db.select().from(schema.splitwiseCategoryMaps).where(eq(schema.splitwiseCategoryMaps.ownerId, owner.id));
  const kws = await db.select().from(schema.keywordRules).where(eq(schema.keywordRules.ownerId, owner.id));
  const confirmed: Record<string, string> = {};
  const suggested: Record<string, string> = {};
  for (const m of maps) {
    const n = m.categoryId ? name.get(m.categoryId) : undefined;
    if (!n) continue;
    (m.status === "confirmed" ? confirmed : suggested)[m.splitwiseName] = n;
  }
  const kw = (k: "grocery" | "phone_bill" | "subscription") => kws.filter((x) => x.kind === k).map((x) => x.keyword);
  return { confirmed, suggested, groceryKeywords: kw("grocery"), phoneBillKeywords: kw("phone_bill"), subscriptionKeywords: kw("subscription") };
}

/** Budget for a month: its saved snapshot if one exists, else the defaults in force for that month. */
export async function loadBudgets(db: AnyDb, owner: Owner, month: MonthKey): Promise<{ budgets: Map<string, number>; source: "month" | "default" }> {
  const cats = await db.select().from(schema.categories).where(eq(schema.categories.ownerId, owner.id));
  const name = new Map(cats.map((c) => [c.id, c.name]));
  const saved = await db
    .select()
    .from(schema.monthBudgets)
    .where(and(eq(schema.monthBudgets.ownerId, owner.id), eq(schema.monthBudgets.month, month)));
  if (saved.length) return { budgets: new Map(saved.map((b) => [name.get(b.categoryId)!, b.amountMinor])), source: "month" };
  const defs = await db.select().from(schema.budgetDefaults).where(eq(schema.budgetDefaults.ownerId, owner.id));
  const latest = new Map<string, { from: string; amount: number }>();
  for (const d of defs) {
    if (compareMonths(d.effectiveFrom, month) > 0) continue;
    const cur = latest.get(d.categoryId);
    if (!cur || compareMonths(d.effectiveFrom, cur.from) > 0) latest.set(d.categoryId, { from: d.effectiveFrom, amount: d.amountMinor });
  }
  return { budgets: new Map([...latest].map(([id, v]) => [name.get(id)!, v.amount])), source: "default" };
}

export async function loadOverrides(db: AnyDb, owner: Owner): Promise<Map<string, { categoryName: string; id: string; version: number }>> {
  const rows = await db
    .select({ o: schema.categoryOverrides, name: schema.categories.name })
    .from(schema.categoryOverrides)
    .innerJoin(schema.categories, eq(schema.categories.id, schema.categoryOverrides.categoryId))
    .where(eq(schema.categoryOverrides.ownerId, owner.id));
  return new Map(rows.map(({ o, name }) => [o.rowKey, { categoryName: name, id: o.id, version: o.version }]));
}
