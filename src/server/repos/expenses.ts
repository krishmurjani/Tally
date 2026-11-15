import { and, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { monthOf } from "@/engines/dates";
import * as schema from "../db/schema";
import type { Owner } from "../owner-core";
import { deriveApiRow } from "../splitwise/derive";
import type { ApiExpense } from "../splitwise/client";
import { ConflictError, NotFoundError } from "./errors";

type AnyDb = NodePgDatabase<typeof schema>;

async function audit(db: AnyDb, owner: Owner, entity: string, entityId: string, action: string, before: unknown, after: unknown) {
  await db.insert(schema.auditLog).values({ ownerId: owner.id, entity, entityId, action, before, after });
}

async function ownCategory(db: AnyDb, owner: Owner, categoryId: string) {
  const [c] = await db.select().from(schema.categories).where(and(eq(schema.categories.id, categoryId), eq(schema.categories.ownerId, owner.id)));
  if (!c) throw new NotFoundError("category", categoryId);
  return c;
}

/** Manual category for a row; persists across syncs; audited; resettable. */
export async function setCategoryOverride(db: AnyDb, owner: Owner, input: { rowKey: string; categoryId: string }) {
  await db.transaction(async (tx) => {
    const cat = await ownCategory(tx, owner, input.categoryId);
    const [prev] = await tx.select().from(schema.categoryOverrides).where(and(eq(schema.categoryOverrides.ownerId, owner.id), eq(schema.categoryOverrides.rowKey, input.rowKey)));
    await tx
      .insert(schema.categoryOverrides)
      .values({ ownerId: owner.id, rowKey: input.rowKey, categoryId: cat.id })
      .onConflictDoUpdate({
        target: [schema.categoryOverrides.ownerId, schema.categoryOverrides.rowKey],
        set: { categoryId: cat.id, version: (prev?.version ?? 0) + 1, updatedAt: new Date() },
      });
    await audit(tx, owner, "category_override", input.rowKey, "set", prev ? { categoryId: prev.categoryId } : null, { categoryId: cat.id, category: cat.name });
  });
}

export async function resetCategoryOverride(db: AnyDb, owner: Owner, input: { rowKey: string }) {
  await db.transaction(async (tx) => {
    const res = await tx
      .delete(schema.categoryOverrides)
      .where(and(eq(schema.categoryOverrides.ownerId, owner.id), eq(schema.categoryOverrides.rowKey, input.rowKey)))
      .returning();
    if (res.length) await audit(tx, owner, "category_override", input.rowKey, "reset", { categoryId: res[0]!.categoryId }, null);
  });
}

/** "Always map this Splitwise category → X" (also how a suggestion gets confirmed). */
export async function mapSplitwiseCategory(db: AnyDb, owner: Owner, input: { splitwiseName: string; categoryId: string }) {
  await db.transaction(async (tx) => {
    const cat = await ownCategory(tx, owner, input.categoryId);
    const [prev] = await tx
      .select()
      .from(schema.splitwiseCategoryMaps)
      .where(and(eq(schema.splitwiseCategoryMaps.ownerId, owner.id), eq(schema.splitwiseCategoryMaps.splitwiseName, input.splitwiseName)));
    await tx
      .insert(schema.splitwiseCategoryMaps)
      .values({ ownerId: owner.id, splitwiseName: input.splitwiseName, categoryId: cat.id, status: "confirmed" })
      .onConflictDoUpdate({
        target: [schema.splitwiseCategoryMaps.ownerId, schema.splitwiseCategoryMaps.splitwiseName],
        set: { categoryId: cat.id, status: "confirmed", version: (prev?.version ?? 0) + 1, updatedAt: new Date() },
      });
    await audit(tx, owner, "splitwise_category_map", input.splitwiseName, "confirm", prev ? { categoryId: prev.categoryId, status: prev.status } : null, { category: cat.name });
  });
}

/** Dismiss (or bring back) the Large flag on one expense. Idempotent. */
export async function setLargeDismissed(db: AnyDb, owner: Owner, input: { rowKey: string; dismissed: boolean }) {
  await db.transaction(async (tx) => {
    if (input.dismissed) {
      await tx.insert(schema.flagDismissals).values({ ownerId: owner.id, rowKey: input.rowKey, flag: "large" }).onConflictDoNothing();
    } else {
      await tx.delete(schema.flagDismissals).where(and(eq(schema.flagDismissals.ownerId, owner.id), eq(schema.flagDismissals.rowKey, input.rowKey)));
    }
    await audit(tx, owner, "flag_dismissal", input.rowKey, input.dismissed ? "dismiss_large" : "restore_large", null, null);
  });
}

export interface ManualExpenseInput {
  date: string;
  description: string;
  categoryId: string;
  amountMinor: number;
  note: string | null;
}

export async function addManualExpense(db: AnyDb, owner: Owner, input: ManualExpenseInput & { idempotencyKey: string }) {
  return db.transaction(async (tx) => {
    await ownCategory(tx, owner, input.categoryId);
    const inserted = await tx
      .insert(schema.manualExpenses)
      .values({ ownerId: owner.id, ...input, month: monthOf(input.date), currency: "USD" })
      .onConflictDoNothing({ target: [schema.manualExpenses.ownerId, schema.manualExpenses.idempotencyKey] })
      .returning();
    // A retried create returns the original row rather than adding a duplicate.
    const row =
      inserted[0] ??
      (await tx.select().from(schema.manualExpenses).where(and(eq(schema.manualExpenses.ownerId, owner.id), eq(schema.manualExpenses.idempotencyKey, input.idempotencyKey))))[0]!;
    if (inserted.length) await audit(tx, owner, "manual_expense", row.id, "create", null, input);
    return row;
  });
}

export async function updateManualExpense(db: AnyDb, owner: Owner, input: ManualExpenseInput & { id: string; expectedVersion: number }) {
  return db.transaction(async (tx) => {
    await ownCategory(tx, owner, input.categoryId);
    const [prev] = await tx.select().from(schema.manualExpenses).where(and(eq(schema.manualExpenses.id, input.id), eq(schema.manualExpenses.ownerId, owner.id), isNull(schema.manualExpenses.deletedAt)));
    if (!prev) throw new NotFoundError("expense", input.id);
    const { id, expectedVersion, ...values } = input;
    const res = await tx
      .update(schema.manualExpenses)
      .set({ ...values, month: monthOf(values.date), version: expectedVersion + 1, updatedAt: new Date() })
      .where(and(eq(schema.manualExpenses.id, id), eq(schema.manualExpenses.ownerId, owner.id), eq(schema.manualExpenses.version, expectedVersion)))
      .returning();
    if (!res.length) throw new ConflictError("expense", id);
    await audit(tx, owner, "manual_expense", id, "update", prev, values);
    return res[0]!;
  });
}

export async function deleteManualExpense(db: AnyDb, owner: Owner, input: { id: string; expectedVersion: number }) {
  await db.transaction(async (tx) => {
    const res = await tx
      .update(schema.manualExpenses)
      .set({ deletedAt: new Date(), version: input.expectedVersion + 1, updatedAt: new Date() })
      .where(and(eq(schema.manualExpenses.id, input.id), eq(schema.manualExpenses.ownerId, owner.id), eq(schema.manualExpenses.version, input.expectedVersion), isNull(schema.manualExpenses.deletedAt)))
      .returning({ id: schema.manualExpenses.id });
    if (!res.length) throw new ConflictError("expense", input.id);
    await audit(tx, owner, "manual_expense", input.id, "delete", null, null);
  });
}

/** Confirm the USD amount of a non-USD Splitwise expense, then re-derive it from its raw JSON. */
export async function confirmUsdAmount(db: AnyDb, owner: Owner, input: { splitwiseId: number; usdMinor: number; note: string | null }) {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.splitwiseExpenses)
      .where(and(eq(schema.splitwiseExpenses.ownerId, owner.id), eq(schema.splitwiseExpenses.splitwiseId, input.splitwiseId)));
    if (!row) throw new NotFoundError("Splitwise expense", String(input.splitwiseId));
    const [o] = await tx.select().from(schema.owners).where(eq(schema.owners.id, owner.id));
    await tx
      .insert(schema.usdConfirmations)
      .values({ ownerId: owner.id, splitwiseId: input.splitwiseId, usdMinor: input.usdMinor, note: input.note })
      .onConflictDoUpdate({ target: [schema.usdConfirmations.ownerId, schema.usdConfirmations.splitwiseId], set: { usdMinor: input.usdMinor, note: input.note, updatedAt: new Date() } });
    const d = deriveApiRow(row.raw as ApiExpense, {
      myUserId: o!.splitwiseUserId!,
      groupNames: new Map(row.groupId ? [[row.groupId, row.groupName ?? ""]] : []),
      usdConfirmation: { usdMinor: input.usdMinor },
    });
    await tx
      .update(schema.splitwiseExpenses)
      .set({ status: d.result.status, reason: d.result.reason, reasonText: d.result.reasonText, shareMinor: d.result.shareMinor, derivation: d.result.derivation, updatedAt: new Date() })
      .where(eq(schema.splitwiseExpenses.id, row.id));
    await audit(tx, owner, "usd_confirmation", String(input.splitwiseId), "set", null, { usdMinor: input.usdMinor });
  });
}
