/**
 * Budget editing. "This month" writes the month's own budget snapshot; "default from month M"
 * writes budget_defaults effective from M. Neither ever rewrites another month's snapshot.
 */
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { MonthKey } from "@/engines/dates";
import * as schema from "../db/schema";
import { getMonthRecord } from "../month-data";
import type { Owner } from "../owner-core";
import { ConflictError, UserFacingError } from "./errors";
import { loadBudgets, loadCategories } from "./rules";

type AnyDb = NodePgDatabase<typeof schema>;

export interface BudgetAmount {
  categoryId: string;
  amountMinor: number;
}

/** Effective budget for a month keyed by category id, plus where it came from. */
export async function budgetForMonth(db: AnyDb, owner: Owner, month: MonthKey) {
  const cats = await loadCategories(db, owner);
  const { budgets, source } = await loadBudgets(db, owner, month);
  return { source, amounts: Object.fromEntries(cats.map((c) => [c.id, budgets.get(c.name) ?? 0])) as Record<string, number> };
}

async function checkUnchanged(tx: AnyDb, owner: Owner, month: MonthKey, expected: Record<string, number>) {
  const now = await budgetForMonth(tx, owner, month);
  for (const [id, amount] of Object.entries(now.amounts)) {
    if ((expected[id] ?? 0) !== amount) throw new ConflictError("budget", month);
  }
}

async function validate(tx: AnyDb, owner: Owner, amounts: BudgetAmount[]) {
  const ids = new Set((await loadCategories(tx, owner)).map((c) => c.id));
  for (const a of amounts) {
    if (!ids.has(a.categoryId)) throw new UserFacingError("Unknown category in the budget");
    if (!Number.isSafeInteger(a.amountMinor) || a.amountMinor < 0) throw new UserFacingError("Budgets can't be negative");
  }
}

export async function saveMonthBudget(db: AnyDb, owner: Owner, input: { month: MonthKey; amounts: BudgetAmount[]; expected: Record<string, number> }) {
  await db.transaction(async (tx) => {
    const rec = await getMonthRecord(tx, owner, input.month);
    if (rec?.status === "closed") throw new UserFacingError("This month is closed — its budget is frozen.");
    await validate(tx, owner, input.amounts);
    await checkUnchanged(tx, owner, input.month, input.expected);
    for (const a of input.amounts) {
      await tx
        .insert(schema.monthBudgets)
        .values({ ownerId: owner.id, month: input.month, categoryId: a.categoryId, amountMinor: a.amountMinor })
        .onConflictDoUpdate({
          target: [schema.monthBudgets.ownerId, schema.monthBudgets.month, schema.monthBudgets.categoryId],
          set: { amountMinor: a.amountMinor, updatedAt: new Date() },
        });
    }
    await tx.insert(schema.auditLog).values({ ownerId: owner.id, entity: "month_budget", entityId: input.month, action: "save", before: input.expected, after: input.amounts });
  });
}

/** New default from `fromMonth` onward. Months with their own saved budget (incl. every closed month) are untouched. */
export async function saveDefaultBudget(db: AnyDb, owner: Owner, input: { fromMonth: MonthKey; amounts: BudgetAmount[]; expected: Record<string, number> }) {
  await db.transaction(async (tx) => {
    await validate(tx, owner, input.amounts);
    await checkUnchanged(tx, owner, input.fromMonth, input.expected);
    // The editing month itself follows the new default only if it has no saved budget of its own.
    const own = await tx.select().from(schema.monthBudgets).where(and(eq(schema.monthBudgets.ownerId, owner.id), eq(schema.monthBudgets.month, input.fromMonth)));
    for (const a of input.amounts) {
      await tx
        .insert(schema.budgetDefaults)
        .values({ ownerId: owner.id, categoryId: a.categoryId, amountMinor: a.amountMinor, effectiveFrom: input.fromMonth })
        .onConflictDoUpdate({
          target: [schema.budgetDefaults.ownerId, schema.budgetDefaults.categoryId, schema.budgetDefaults.effectiveFrom],
          set: { amountMinor: a.amountMinor, updatedAt: new Date() },
        });
      if (own.length) {
        await tx
          .update(schema.monthBudgets)
          .set({ amountMinor: a.amountMinor, updatedAt: new Date() })
          .where(and(eq(schema.monthBudgets.ownerId, owner.id), eq(schema.monthBudgets.month, input.fromMonth), eq(schema.monthBudgets.categoryId, a.categoryId)));
      }
    }
    await tx.insert(schema.auditLog).values({ ownerId: owner.id, entity: "budget_default", entityId: input.fromMonth, action: "save", before: input.expected, after: input.amounts });
  });
}

export async function createCategory(db: AnyDb, owner: Owner, input: { name: string }) {
  const name = input.name.trim();
  if (!name) throw new UserFacingError("Give the category a name");
  return db.transaction(async (tx) => {
    const existing = await loadCategories(tx, owner);
    if (existing.some((c) => c.name.toLowerCase() === name.toLowerCase())) throw new UserFacingError(`"${name}" already exists`);
    const [row] = await tx
      .insert(schema.categories)
      .values({ ownerId: owner.id, name, kind: "custom", sortOrder: 100 + existing.length })
      .returning();
    await tx.insert(schema.auditLog).values({ ownerId: owner.id, entity: "category", entityId: row!.id, action: "create", before: null, after: { name } });
    return { id: row!.id, name: row!.name };
  });
}
