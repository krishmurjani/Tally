/**
 * Splitwise sync. Network calls happen first; then everything is written in ONE transaction:
 * idempotent upsert keyed by (owner, splitwise_id), derived fields recomputed from raw JSON,
 * "missing from Splitwise" detection, pre-seeded decision pinning, and closed-month change flags.
 */
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { diffFingerprint, diffSnapshots, type MonthSnapshot } from "@/engines/close";
import { addDays, monthBounds, type MonthKey } from "@/engines/dates";
import { REASON_TEXT } from "@/engines/types";
import * as schema from "../db/schema";
import { apiLedgerRows, decisionCandidates, getMonthRecord, liveSnapshot } from "../month-data";
import type { Owner } from "../owner-core";
import { pinPendingForMonth } from "../repos/decisions";
import type { ApiExpense, SplitwiseApi } from "./client";
import { deriveApiRow, hashRaw } from "./derive";

type AnyDb = NodePgDatabase<typeof schema>;

export class SourceConflictError extends Error {
  constructor(public readonly month: string) {
    super(`${month} uses CSV import as its data source. Switch the month to Splitwise sync first.`);
    this.name = "SourceConflictError";
  }
}

export interface SyncReport {
  runId: string;
  fetched: number;
  inserted: number;
  updated: number;
  unchanged: number;
  missing: number;
  pinned: number;
  monthsTouched: string[];
  closedMonthsChanged: string[];
}

async function ensureSplitwiseUser(db: AnyDb, owner: Owner, api: SplitwiseApi): Promise<number> {
  const [o] = await db.select({ id: schema.owners.splitwiseUserId }).from(schema.owners).where(eq(schema.owners.id, owner.id));
  if (o?.id) return o.id;
  const me = await api.getCurrentUser();
  await db.update(schema.owners).set({ splitwiseUserId: me.id, updatedAt: new Date() }).where(eq(schema.owners.id, owner.id));
  return me.id;
}

async function upsertExpenses(
  tx: AnyDb,
  owner: Owner,
  fetched: { parsed: ApiExpense; raw: unknown }[],
  ctx: { myUserId: number; groupNames: Map<number, string>; runId: string },
) {
  const ids = fetched.map((f) => f.parsed.id);
  const existing = ids.length
    ? await tx
        .select({ id: schema.splitwiseExpenses.splitwiseId, hash: schema.splitwiseExpenses.rawHash, month: schema.splitwiseExpenses.month })
        .from(schema.splitwiseExpenses)
        .where(and(eq(schema.splitwiseExpenses.ownerId, owner.id), inArray(schema.splitwiseExpenses.splitwiseId, ids)))
    : [];
  const before = new Map(existing.map((e) => [e.id, e]));
  const confirmations = ids.length
    ? await tx.select().from(schema.usdConfirmations).where(and(eq(schema.usdConfirmations.ownerId, owner.id), inArray(schema.usdConfirmations.splitwiseId, ids)))
    : [];
  const usd = new Map(confirmations.map((c) => [c.splitwiseId, { usdMinor: c.usdMinor }]));

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  const months = new Set<string>();
  for (const { parsed, raw } of fetched) {
    const d = deriveApiRow(parsed, { myUserId: ctx.myUserId, groupNames: ctx.groupNames, usdConfirmation: usd.get(parsed.id) ?? null });
    const rawHash = hashRaw(raw);
    const prev = before.get(parsed.id);
    if (!prev) inserted++;
    else if (prev.hash !== rawHash) updated++;
    else unchanged++;
    months.add(d.month);
    if (prev && prev.month !== d.month) months.add(prev.month); // moved between months
    const values = {
      raw,
      rawHash,
      swUpdatedAt: d.swUpdatedAt,
      swDeletedAt: d.swDeletedAt,
      lastSeenSyncId: ctx.runId,
      missingSince: null,
      accountingDate: d.accountingDate,
      month: d.month,
      description: d.description,
      costMinor: d.costMinor,
      currency: d.currency,
      myOwedMinor: d.myOwedMinor,
      myPaidMinor: d.myPaidMinor,
      groupId: d.groupId,
      groupName: d.groupName,
      swCategory: d.swCategory,
      status: d.result.status,
      reason: d.result.reason,
      reasonText: d.result.reasonText,
      shareMinor: d.result.shareMinor,
      derivation: d.result.derivation,
      updatedAt: new Date(),
    };
    await tx
      .insert(schema.splitwiseExpenses)
      .values({ ownerId: owner.id, splitwiseId: parsed.id, ...values })
      .onConflictDoUpdate({ target: [schema.splitwiseExpenses.ownerId, schema.splitwiseExpenses.splitwiseId], set: values });
  }
  return { inserted, updated, unchanged, months };
}

/** Stored rows of the month that this full-month fetch didn't return (and aren't marked deleted). */
async function markMissing(tx: AnyDb, owner: Owner, month: MonthKey, runId: string): Promise<number> {
  const res = await tx
    .update(schema.splitwiseExpenses)
    .set({
      missingSince: sql`coalesce(${schema.splitwiseExpenses.missingSince}, now())`,
      status: "review",
      reason: "missing_in_splitwise",
      reasonText: REASON_TEXT.missing_in_splitwise,
      shareMinor: 0,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.splitwiseExpenses.ownerId, owner.id),
        eq(schema.splitwiseExpenses.month, month),
        isNull(schema.splitwiseExpenses.swDeletedAt),
        ne(schema.splitwiseExpenses.reason, "no_share"),
        or(isNull(schema.splitwiseExpenses.lastSeenSyncId), ne(schema.splitwiseExpenses.lastSeenSyncId, runId)),
      ),
    )
    .returning({ id: schema.splitwiseExpenses.id });
  return res.length;
}

async function ensureApiMonth(tx: AnyDb, owner: Owner, month: MonthKey, { claim }: { claim: boolean }) {
  const rec = await getMonthRecord(tx, owner, month);
  if (rec?.dataSource === "csv") throw new SourceConflictError(month);
  if (!rec) {
    if (!claim) return null;
    await tx.insert(schema.months).values({ ownerId: owner.id, month, dataSource: "api" }).onConflictDoNothing();
  } else if (!rec.dataSource && claim) {
    await tx.update(schema.months).set({ dataSource: "api", updatedAt: new Date() }).where(eq(schema.months.id, rec.id));
  }
  return getMonthRecord(tx, owner, month);
}

/** If a closed month's live data no longer matches its snapshot, record the diff (never change the snapshot). */
export async function flagClosedMonth(tx: AnyDb, owner: Owner, month: MonthKey): Promise<boolean> {
  const rec = await getMonthRecord(tx, owner, month);
  if (rec?.status !== "closed" || !rec.snapshot) return false;
  const { snapshot } = await liveSnapshot(tx, owner, month, rec.dataSource);
  const diff = diffSnapshots(rec.snapshot as MonthSnapshot, snapshot);
  const fp = diff.hasChanges ? hashRaw(diffFingerprint(diff)) : null;
  const flagged = diff.hasChanges && fp !== rec.keptDiffHash;
  await tx
    .update(schema.months)
    .set({ pendingChanges: flagged ? diff : null, updatedAt: new Date() })
    .where(eq(schema.months.id, rec.id));
  return flagged;
}

async function afterUpsert(tx: AnyDb, owner: Owner, months: Iterable<string>) {
  let pinned = 0;
  const closedChanged: string[] = [];
  for (const m of months) {
    const rec = await getMonthRecord(tx, owner, m);
    if (rec?.dataSource !== "api") continue; // only months that use the API as their source
    pinned += await pinPendingForMonth(tx, owner, m, decisionCandidates(await apiLedgerRows(tx, owner, m)));
    if (await flagClosedMonth(tx, owner, m)) closedChanged.push(m);
  }
  return { pinned, closedChanged };
}

async function startRun(db: AnyDb, owner: Owner, v: Partial<typeof schema.syncRuns.$inferInsert> & { kind: "month" | "changes" }) {
  const [run] = await db.insert(schema.syncRuns).values({ ownerId: owner.id, ...v }).returning({ id: schema.syncRuns.id });
  return run!.id;
}

async function failRun(db: AnyDb, runId: string, e: unknown) {
  await db
    .update(schema.syncRuns)
    .set({ finishedAt: new Date(), error: e instanceof Error ? e.message : String(e) })
    .where(eq(schema.syncRuns.id, runId));
}

/** Fetch one month (with a 1-day margin either side for the New York date conversion) and store it. */
export async function syncMonth(db: AnyDb, owner: Owner, api: SplitwiseApi, month: MonthKey): Promise<SyncReport> {
  const pre = await getMonthRecord(db, owner, month);
  if (pre?.dataSource === "csv") throw new SourceConflictError(month);
  const { start, end } = monthBounds(month);
  const runId = await startRun(db, owner, { kind: "month", rangeFrom: start, rangeTo: end });
  try {
    const myUserId = await ensureSplitwiseUser(db, owner, api);
    const groups = await api.getGroups();
    const fetched = await api.getExpenses({ datedAfter: `${addDays(start, -1)}T00:00:00Z`, datedBefore: `${addDays(end, 2)}T00:00:00Z` });
    const report = await db.transaction(async (tx) => {
      await ensureApiMonth(tx, owner, month, { claim: true });
      const up = await upsertExpenses(tx, owner, fetched, { myUserId, groupNames: new Map(groups.map((g) => [g.id, g.name])), runId });
      const missing = await markMissing(tx, owner, month, runId);
      const after = await afterUpsert(tx, owner, new Set([month, ...up.months]));
      const counts = { fetched: fetched.length, inserted: up.inserted, updated: up.updated, unchanged: up.unchanged, missing, pinned: after.pinned };
      await tx.update(schema.syncRuns).set({ finishedAt: new Date(), counts }).where(eq(schema.syncRuns.id, runId));
      return { runId, ...counts, monthsTouched: [...up.months].sort(), closedMonthsChanged: after.closedChanged };
    });
    return report;
  } catch (e) {
    await failRun(db, runId, e);
    throw e;
  }
}

/** Change detection: everything updated since the last successful sync (5-minute overlap). */
export async function syncChanges(db: AnyDb, owner: Owner, api: SplitwiseApi): Promise<SyncReport | null> {
  const [last] = await db
    .select({ startedAt: schema.syncRuns.startedAt })
    .from(schema.syncRuns)
    .where(and(eq(schema.syncRuns.ownerId, owner.id), isNull(schema.syncRuns.error), sql`${schema.syncRuns.finishedAt} is not null`))
    .orderBy(sql`${schema.syncRuns.startedAt} desc`)
    .limit(1);
  if (!last) return null;
  const since = new Date(last.startedAt.getTime() - 5 * 60_000);
  const runId = await startRun(db, owner, { kind: "changes", updatedAfter: since });
  try {
    const myUserId = await ensureSplitwiseUser(db, owner, api);
    const groups = await api.getGroups();
    const fetched = await api.getExpenses({ updatedAfter: since.toISOString() });
    return await db.transaction(async (tx) => {
      const up = await upsertExpenses(tx, owner, fetched, { myUserId, groupNames: new Map(groups.map((g) => [g.id, g.name])), runId });
      const after = await afterUpsert(tx, owner, up.months);
      const counts = { fetched: fetched.length, inserted: up.inserted, updated: up.updated, unchanged: up.unchanged, missing: 0, pinned: after.pinned };
      await tx.update(schema.syncRuns).set({ finishedAt: new Date(), counts }).where(eq(schema.syncRuns.id, runId));
      return { runId, ...counts, monthsTouched: [...up.months].sort(), closedMonthsChanged: after.closedChanged };
    });
  } catch (e) {
    await failRun(db, runId, e);
    throw e;
  }
}
