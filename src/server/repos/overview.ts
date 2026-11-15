import { count, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import type { Owner } from "../owner-core";

type AnyDb = NodePgDatabase<typeof schema>;

/** Row counts per table for this owner (Settings → data status). */
export async function dataStatus(db: AnyDb, owner: Owner) {
  const tables = {
    categories: schema.categories,
    budgetDefaults: schema.budgetDefaults,
    categoryMaps: schema.splitwiseCategoryMaps,
    keywordRules: schema.keywordRules,
    recurringRules: schema.recurringRules,
    decisions: schema.expenseDecisions,
    lenderPayments: schema.lenderPayments,
    reimbursements: schema.sisterReimbursements,
    splitwiseExpenses: schema.splitwiseExpenses,
    incomeEntries: schema.incomeEntries,
  } as const;
  const out: Record<string, number> = {};
  for (const [name, table] of Object.entries(tables)) {
    const [r] = await db.select({ n: count() }).from(table).where(eq(table.ownerId, owner.id));
    out[name] = r?.n ?? 0;
  }
  return out as Record<keyof typeof tables, number>;
}
