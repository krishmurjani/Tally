import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { diffFingerprint, type SnapshotDiff } from "@/engines/close";
import type { MonthKey } from "@/engines/dates";
import * as schema from "../db/schema";
import { getMonthRecord, liveSnapshot } from "../month-data";
import type { Owner } from "../owner-core";
import { hashRaw } from "../splitwise/derive";
import { refreshCsvMonths } from "./csv-import";
import { ConflictError, NotFoundError } from "./errors";

type AnyDb = NodePgDatabase<typeof schema>;

export class ClosingBlockedError extends Error {
  constructor(public readonly review: number, public readonly needsCategory: number) {
    super(`Resolve ${[review && `${review} item(s) needing review`, needsCategory && `${needsCategory} item(s) needing a category`].filter(Boolean).join(" and ")} before closing.`);
    this.name = "ClosingBlockedError";
  }
}

async function audit(db: AnyDb, owner: Owner, month: string, action: string, after: unknown) {
  await db.insert(schema.auditLog).values({ ownerId: owner.id, entity: "month", entityId: month, action, before: null, after });
}

/** Freeze the month: snapshot rows, category totals and budgets. Blocked while anything needs review or a category. */
export async function closeMonth(db: AnyDb, owner: Owner, input: { month: MonthKey; expectedVersion: number | null }) {
  return db.transaction(async (tx) => {
    const rec = await getMonthRecord(tx, owner, input.month);
    if (rec && rec.version !== input.expectedVersion) throw new ConflictError("month", input.month);
    if (rec?.status === "closed") throw new ConflictError("month", input.month);
    const { live, snapshot } = await liveSnapshot(tx, owner, input.month, rec?.dataSource ?? null);
    if (!live.hasData) throw new NotFoundError("month data", input.month);
    const review = live.rows.filter((r) => r.result.status === "review").length;
    const needsCategory = live.rows.filter((r) => r.flags.includes("needs_category")).length;
    if (review || needsCategory) throw new ClosingBlockedError(review, needsCategory);

    // Freeze this month's budget so later default changes can't rewrite it.
    if (live.budgetSource === "default") {
      const ids = new Map(live.categories.map((c) => [c.name, c.id]));
      const values = [...live.budgets].filter(([name]) => ids.has(name)).map(([name, amountMinor]) => ({ ownerId: owner.id, month: input.month, categoryId: ids.get(name)!, amountMinor }));
      if (values.length) await tx.insert(schema.monthBudgets).values(values).onConflictDoNothing();
    }
    const set = { status: "closed" as const, closedAt: new Date(), snapshot, snapshotHash: hashRaw(snapshot), pendingChanges: null, keptDiffHash: null, updatedAt: new Date() };
    if (rec) {
      const res = await tx
        .update(schema.months)
        .set({ ...set, version: rec.version + 1 })
        .where(and(eq(schema.months.id, rec.id), eq(schema.months.version, rec.version)))
        .returning({ id: schema.months.id });
      if (!res.length) throw new ConflictError("month", input.month);
    } else {
      await tx.insert(schema.months).values({ ownerId: owner.id, month: input.month, ...set });
    }
    await audit(tx, owner, input.month, "close", { totalMinor: snapshot.totalMinor });
    return snapshot;
  });
}

async function closedRecord(tx: AnyDb, owner: Owner, month: MonthKey, expectedVersion: number) {
  const rec = await getMonthRecord(tx, owner, month);
  if (!rec || rec.status !== "closed") throw new NotFoundError("closed month", month);
  if (rec.version !== expectedVersion) throw new ConflictError("month", month);
  return rec;
}

/** "Accept" the changes found after close: recompute the snapshot from the live data. */
export async function acceptChanges(db: AnyDb, owner: Owner, input: { month: MonthKey; expectedVersion: number }) {
  return db.transaction(async (tx) => {
    const rec = await closedRecord(tx, owner, input.month, input.expectedVersion);
    const { live, snapshot } = await liveSnapshot(tx, owner, input.month, rec.dataSource);
    const review = live.rows.filter((r) => r.result.status === "review").length;
    const needsCategory = live.rows.filter((r) => r.flags.includes("needs_category")).length;
    if (review || needsCategory) throw new ClosingBlockedError(review, needsCategory);
    // keep the budget the month was closed with
    const frozen = { ...snapshot, budgets: (rec.snapshot as { budgets?: Record<string, number> }).budgets ?? snapshot.budgets };
    const res = await tx
      .update(schema.months)
      .set({ snapshot: frozen, snapshotHash: hashRaw(frozen), pendingChanges: null, keptDiffHash: null, version: rec.version + 1, updatedAt: new Date() })
      .where(and(eq(schema.months.id, rec.id), eq(schema.months.version, rec.version)))
      .returning({ id: schema.months.id });
    if (!res.length) throw new ConflictError("month", input.month);
    await audit(tx, owner, input.month, "accept_changes", { totalMinor: frozen.totalMinor });
    return frozen;
  });
}

/** "Keep snapshot": dismiss this exact diff. A different later change will be flagged again. */
export async function keepSnapshot(db: AnyDb, owner: Owner, input: { month: MonthKey; expectedVersion: number }) {
  await db.transaction(async (tx) => {
    const rec = await closedRecord(tx, owner, input.month, input.expectedVersion);
    const diff = rec.pendingChanges as SnapshotDiff | null;
    if (!diff) return;
    const res = await tx
      .update(schema.months)
      .set({ pendingChanges: null, keptDiffHash: hashRaw(diffFingerprint(diff)), version: rec.version + 1, updatedAt: new Date() })
      .where(and(eq(schema.months.id, rec.id), eq(schema.months.version, rec.version)))
      .returning({ id: schema.months.id });
    if (!res.length) throw new ConflictError("month", input.month);
    await audit(tx, owner, input.month, "keep_snapshot", null);
  });
}

/** Choose where a month's Splitwise data comes from. Never mixes sources. */
export async function setMonthSource(db: AnyDb, owner: Owner, input: { month: MonthKey; source: "api" | "csv" }) {
  return db.transaction(async (tx) => {
    const rec = await getMonthRecord(tx, owner, input.month);
    if (rec?.status === "closed") throw new ConflictError("month", input.month);
    if (rec) {
      await tx.update(schema.months).set({ dataSource: input.source, version: rec.version + 1, updatedAt: new Date() }).where(eq(schema.months.id, rec.id));
    } else {
      await tx.insert(schema.months).values({ ownerId: owner.id, month: input.month, dataSource: input.source });
    }
    await audit(tx, owner, input.month, "set_source", { source: input.source });
    if (input.source === "csv") await refreshCsvMonths(tx, owner);
  });
}

/** Open a closed month again. Discards its snapshot; its budget snapshot (month_budgets) is kept. */
export async function reopenMonth(db: AnyDb, owner: Owner, input: { month: MonthKey; expectedVersion: number }) {
  await db.transaction(async (tx) => {
    const rec = await closedRecord(tx, owner, input.month, input.expectedVersion);
    const res = await tx
      .update(schema.months)
      .set({ status: "open", closedAt: null, snapshot: null, snapshotHash: null, pendingChanges: null, keptDiffHash: null, version: rec.version + 1, updatedAt: new Date() })
      .where(and(eq(schema.months.id, rec.id), eq(schema.months.version, rec.version)))
      .returning({ id: schema.months.id });
    if (!res.length) throw new ConflictError("month", input.month);
    await audit(tx, owner, input.month, "reopen", { totalMinor: (rec.snapshot as { totalMinor?: number } | null)?.totalMinor ?? null });
  });
}
