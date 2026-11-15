import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { MonthKey } from "@/engines/dates";
import type { RecurringOverride, RecurringRule } from "@/engines/recurring";
import * as schema from "../db/schema";
import type { Owner } from "../owner-core";

type AnyDb = NodePgDatabase<typeof schema>;

export async function loadRecurring(db: AnyDb, owner: Owner): Promise<{ rules: RecurringRule[]; overrides: RecurringOverride[] }> {
  const rows = await db
    .select({ r: schema.recurringRules, category: schema.categories.name })
    .from(schema.recurringRules)
    .innerJoin(schema.categories, eq(schema.categories.id, schema.recurringRules.categoryId))
    .where(eq(schema.recurringRules.ownerId, owner.id));
  const ovs = await db.select().from(schema.recurringOverrides).where(eq(schema.recurringOverrides.ownerId, owner.id));
  return {
    rules: rows.map(({ r, category }) => ({
      id: r.id,
      series: r.series,
      name: r.name,
      category,
      amountMinor: r.amountMinor,
      effectiveFrom: r.effectiveFrom,
      effectiveTo: r.effectiveTo,
      dayOfMonth: r.dayOfMonth,
    })),
    overrides: ovs.map((o) => ({ series: o.series, month: o.month, amountMinor: o.amountMinor, note: o.note })),
  };
}

/** Add a new version of a recurring series from a future month (e.g. new rent after moving). */
export async function addRecurringVersion(
  db: AnyDb,
  owner: Owner,
  input: { series: string; effectiveFrom: MonthKey; amountMinor: number },
): Promise<void> {
  const [base] = await db
    .select()
    .from(schema.recurringRules)
    .where(and(eq(schema.recurringRules.ownerId, owner.id), eq(schema.recurringRules.series, input.series)))
    .limit(1);
  if (!base) throw new Error(`No recurring series "${input.series}"`);
  await db.insert(schema.recurringRules).values({
    ownerId: owner.id,
    series: input.series,
    name: base.name,
    categoryId: base.categoryId,
    amountMinor: input.amountMinor,
    effectiveFrom: input.effectiveFrom,
    dayOfMonth: base.dayOfMonth,
  });
}
