import { randomBytes } from "node:crypto";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { compareMonths, type MonthKey } from "@/engines/dates";
import type { RecurringOverride, RecurringRule } from "@/engines/recurring";
import * as schema from "../db/schema";
import type { Owner } from "../owner-core";
import { NotFoundError, UserFacingError } from "./errors";

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


// ---------------------------------------------------------------------------------------------- managing rules

async function audit(db: AnyDb, owner: Owner, entity: string, entityId: string, action: string, before: unknown, after: unknown) {
  await db.insert(schema.auditLog).values({ ownerId: owner.id, entity, entityId, action, before, after });
}

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "item";

async function ownCategory(db: AnyDb, owner: Owner, categoryId: string) {
  const [c] = await db.select({ id: schema.categories.id }).from(schema.categories).where(and(eq(schema.categories.id, categoryId), eq(schema.categories.ownerId, owner.id)));
  if (!c) throw new NotFoundError("category", categoryId);
}

async function versionsOf(db: AnyDb, owner: Owner, series: string) {
  const rows = await db
    .select()
    .from(schema.recurringRules)
    .where(and(eq(schema.recurringRules.ownerId, owner.id), eq(schema.recurringRules.series, series)))
    .orderBy(asc(schema.recurringRules.effectiveFrom));
  if (rows.length === 0) throw new NotFoundError("recurring item", series);
  return rows;
}

export interface NewRecurring {
  name: string;
  categoryId: string;
  amountMinor: number;
  dayOfMonth: number;
  effectiveFrom: MonthKey;
  /** The last month it applies. null = no end. */
  effectiveTo: MonthKey | null;
}

/** A new recurring item. For an instalment, give the last month. */
export async function createRecurring(db: AnyDb, owner: Owner, input: NewRecurring): Promise<{ series: string }> {
  if (input.amountMinor <= 0) throw new UserFacingError("The amount must be more than zero.");
  if (input.effectiveTo && compareMonths(input.effectiveTo, input.effectiveFrom) < 0) throw new UserFacingError("The last month can't be before the first.");
  return db.transaction(async (tx) => {
    await ownCategory(tx, owner, input.categoryId);
    const series = `${slug(input.name)}-${randomBytes(2).toString("hex")}`;
    await tx.insert(schema.recurringRules).values({
      ownerId: owner.id,
      series,
      name: input.name.trim(),
      categoryId: input.categoryId,
      amountMinor: input.amountMinor,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
      dayOfMonth: input.dayOfMonth,
    });
    await audit(tx, owner, "recurring", series, "create", null, input);
    return { series };
  });
}

/**
 * Change an item from a month onward: a new version starting then (or an edit of the version that already starts then).
 * Earlier months keep what they had. Only the latest version carries the end month, so that stays true here.
 */
export async function setRecurringFrom(
  db: AnyDb,
  owner: Owner,
  input: { series: string; from: MonthKey; amountMinor: number; name?: string; categoryId?: string; dayOfMonth?: number },
): Promise<void> {
  if (input.amountMinor <= 0) throw new UserFacingError("The amount must be more than zero.");
  await db.transaction(async (tx) => {
    const versions = await versionsOf(tx, owner, input.series);
    const greatest = versions[versions.length - 1]!;
    if (greatest.effectiveTo && compareMonths(input.from, greatest.effectiveTo) > 0) throw new UserFacingError("That month is after the last payment. Move the end date first.");
    if (input.categoryId) await ownCategory(tx, owner, input.categoryId);
    const inForce = [...versions].reverse().find((v) => compareMonths(v.effectiveFrom, input.from) <= 0) ?? versions[0]!;
    const values = { name: input.name?.trim() || inForce.name, categoryId: input.categoryId ?? inForce.categoryId, amountMinor: input.amountMinor, dayOfMonth: input.dayOfMonth ?? inForce.dayOfMonth };
    const existing = versions.find((v) => v.effectiveFrom === input.from);
    if (existing) {
      await tx.update(schema.recurringRules).set({ ...values, version: sql`${schema.recurringRules.version} + 1`, updatedAt: new Date() }).where(eq(schema.recurringRules.id, existing.id));
    } else {
      const becomesLatest = compareMonths(input.from, greatest.effectiveFrom) > 0;
      await tx.insert(schema.recurringRules).values({ ownerId: owner.id, series: input.series, effectiveFrom: input.from, effectiveTo: becomesLatest ? greatest.effectiveTo : null, ...values });
      if (becomesLatest && greatest.effectiveTo) await tx.update(schema.recurringRules).set({ effectiveTo: null, updatedAt: new Date() }).where(eq(schema.recurringRules.id, greatest.id));
    }
    await audit(tx, owner, "recurring", input.series, "change_from", null, input);
  });
}

/** Set the last month an item applies (null = no end). Versions that would start after it are removed. */
export async function setRecurringEnd(db: AnyDb, owner: Owner, input: { series: string; lastMonth: MonthKey | null }): Promise<void> {
  await db.transaction(async (tx) => {
    const versions = await versionsOf(tx, owner, input.series);
    const keep = input.lastMonth ? versions.filter((v) => compareMonths(v.effectiveFrom, input.lastMonth!) <= 0) : versions;
    if (keep.length === 0) throw new UserFacingError("It starts after that month. Pick a later month, or delete it.");
    if (input.lastMonth) await tx.delete(schema.recurringRules).where(and(eq(schema.recurringRules.ownerId, owner.id), eq(schema.recurringRules.series, input.series), gt(schema.recurringRules.effectiveFrom, input.lastMonth)));
    const latest = keep[keep.length - 1]!;
    for (const v of keep) {
      const to = v.id === latest.id ? input.lastMonth : null;
      if (v.effectiveTo !== to) await tx.update(schema.recurringRules).set({ effectiveTo: to, version: sql`${schema.recurringRules.version} + 1`, updatedAt: new Date() }).where(eq(schema.recurringRules.id, v.id));
    }
    await audit(tx, owner, "recurring", input.series, "set_end", null, { lastMonth: input.lastMonth });
  });
}

/** This month only: skip it (amountMinor null), charge a different amount, or put it back to normal (clear). */
export async function setRecurringOverride(db: AnyDb, owner: Owner, input: { series: string; month: MonthKey; amountMinor: number | null; note: string | null; clear?: boolean }): Promise<void> {
  await db.transaction(async (tx) => {
    await versionsOf(tx, owner, input.series);
    if (input.clear) {
      await tx.delete(schema.recurringOverrides).where(and(eq(schema.recurringOverrides.ownerId, owner.id), eq(schema.recurringOverrides.series, input.series), eq(schema.recurringOverrides.month, input.month)));
    } else {
      if (input.amountMinor !== null && input.amountMinor <= 0) throw new UserFacingError("The amount must be more than zero. To charge nothing, skip the month.");
      await tx
        .insert(schema.recurringOverrides)
        .values({ ownerId: owner.id, series: input.series, month: input.month, amountMinor: input.amountMinor, note: input.note })
        .onConflictDoUpdate({
          target: [schema.recurringOverrides.ownerId, schema.recurringOverrides.series, schema.recurringOverrides.month],
          set: { amountMinor: input.amountMinor, note: input.note, version: sql`${schema.recurringOverrides.version} + 1`, updatedAt: new Date() },
        });
    }
    await audit(tx, owner, "recurring", input.series, input.clear ? "clear_override" : "override", null, input);
  });
}

/** Remove an item entirely. Closed months keep the numbers they were closed with; open months stop including it. */
export async function deleteRecurring(db: AnyDb, owner: Owner, series: string): Promise<void> {
  await db.transaction(async (tx) => {
    await versionsOf(tx, owner, series);
    await tx.delete(schema.recurringOverrides).where(and(eq(schema.recurringOverrides.ownerId, owner.id), eq(schema.recurringOverrides.series, series)));
    await tx.delete(schema.recurringRules).where(and(eq(schema.recurringRules.ownerId, owner.id), eq(schema.recurringRules.series, series)));
    await audit(tx, owner, "recurring", series, "delete", null, null);
  });
}
