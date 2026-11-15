import { and, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { pinDecisions, type DecisionCandidate } from "@/engines/decisions";
import * as schema from "../db/schema";
import type { Owner } from "../owner-core";
import { ConflictError, NotFoundError } from "./errors";

type AnyDb = NodePgDatabase<typeof schema>;

export interface DecisionRecord {
  id: string;
  rowKey: string | null;
  reason: string | null;
  state: "pending" | "pinned" | "revoked";
  origin: "preseed" | "local" | "manual";
  matchSpec: { date: string; description: string; costMinor: number; group?: string | null } | null;
  version: number;
}

export async function loadDecisions(db: AnyDb, owner: Owner): Promise<DecisionRecord[]> {
  const rows = await db.select().from(schema.expenseDecisions).where(eq(schema.expenseDecisions.ownerId, owner.id));
  return rows.map((r) => ({ id: r.id, rowKey: r.rowKey, reason: r.reason, state: r.state, origin: r.origin, matchSpec: r.matchSpec, version: r.version }));
}

/** Map of row key → active decision. */
export function pinnedMap(decisions: DecisionRecord[]): Map<string, DecisionRecord> {
  return new Map(decisions.filter((d) => d.state === "pinned" && d.rowKey).map((d) => [d.rowKey!, d]));
}

/**
 * Pin pending pre-seeded/local decisions for a month to a unique matching row.
 * Rows already decided can't be claimed twice. Returns how many were pinned.
 */
export async function pinPendingForMonth(db: AnyDb, owner: Owner, month: string, candidates: DecisionCandidate[]): Promise<number> {
  const all = await loadDecisions(db, owner);
  const taken = new Set(all.filter((d) => d.state === "pinned").map((d) => d.rowKey));
  const pending = all.filter((d) => d.state === "pending" && d.matchSpec?.date.startsWith(month));
  if (!pending.length) return 0;
  const outcomes = pinDecisions(
    pending.map((d) => ({ id: d.id, date: d.matchSpec!.date, description: d.matchSpec!.description, costMinor: d.matchSpec!.costMinor, group: d.matchSpec!.group ?? null, reason: d.reason ?? "" })),
    candidates.filter((c) => !taken.has(c.key)),
  );
  let n = 0;
  for (const o of outcomes) {
    if (o.state !== "pinned") continue;
    const d = pending.find((p) => p.id === o.specId)!;
    await db
      .update(schema.expenseDecisions)
      .set({ state: "pinned", rowKey: o.key, version: d.version + 1, updatedAt: new Date() })
      .where(and(eq(schema.expenseDecisions.id, d.id), eq(schema.expenseDecisions.version, d.version)));
    await audit(db, owner, d.id, "pin", { state: "pending" }, { state: "pinned", rowKey: o.key });
    n++;
  }
  return n;
}

async function audit(db: AnyDb, owner: Owner, id: string, action: string, before: unknown, after: unknown) {
  await db.insert(schema.auditLog).values({ ownerId: owner.id, entity: "expense_decision", entityId: id, action, before, after });
}

/** One-tap "Not an expense" on a row. Idempotent by key; refuses if the row already has a decision. */
export async function markNotExpense(db: AnyDb, owner: Owner, input: { rowKey: string; reason: string | null; idempotencyKey: string }): Promise<DecisionRecord> {
  return db.transaction(async (tx) => {
    const [dupe] = await tx
      .select()
      .from(schema.expenseDecisions)
      .where(and(eq(schema.expenseDecisions.ownerId, owner.id), eq(schema.expenseDecisions.idempotencyKey, input.idempotencyKey)));
    if (dupe) return (await loadDecisions(tx, owner)).find((d) => d.id === dupe.id)!;
    const active = pinnedMap(await loadDecisions(tx, owner)).get(input.rowKey);
    if (active) throw new ConflictError("decision", active.id);
    const [row] = await tx
      .insert(schema.expenseDecisions)
      .values({ ownerId: owner.id, rowKey: input.rowKey, reason: input.reason?.trim() || null, state: "pinned", origin: "manual", idempotencyKey: input.idempotencyKey })
      .returning();
    await audit(tx, owner, row!.id, "create", null, { rowKey: input.rowKey, reason: row!.reason });
    return { id: row!.id, rowKey: row!.rowKey, reason: row!.reason, state: row!.state, origin: row!.origin, matchSpec: null, version: row!.version };
  });
}

/** "Not an expense" on many rows. Rows that already have an active decision are skipped, not failed. Idempotent per row. */
export async function markNotExpenseBulk(db: AnyDb, owner: Owner, input: { rowKeys: string[]; reason: string | null; idempotencyKey: string }) {
  const keys = [...new Set(input.rowKeys)];
  return db.transaction(async (tx) => {
    const active = pinnedMap(await loadDecisions(tx, owner));
    let marked = 0;
    for (const rowKey of keys) {
      if (active.has(rowKey)) continue;
      const ins = await tx
        .insert(schema.expenseDecisions)
        .values({ ownerId: owner.id, rowKey, reason: input.reason?.trim() || null, state: "pinned", origin: "manual", idempotencyKey: `${input.idempotencyKey}:${rowKey}` })
        .onConflictDoNothing()
        .returning({ id: schema.expenseDecisions.id });
      if (ins.length) {
        marked++;
        await audit(tx, owner, ins[0]!.id, "create", null, { rowKey, bulk: true });
      }
    }
    return { marked, skipped: keys.length - marked };
  });
}

/** Undo: the decision is revoked (kept for history), the row counts again. */
export async function revokeDecision(db: AnyDb, owner: Owner, input: { id: string; expectedVersion: number }): Promise<void> {
  await db.transaction(async (tx) => {
    const [d] = await tx
      .select()
      .from(schema.expenseDecisions)
      .where(and(eq(schema.expenseDecisions.ownerId, owner.id), eq(schema.expenseDecisions.id, input.id)));
    if (!d) throw new NotFoundError("decision", input.id);
    const res = await tx
      .update(schema.expenseDecisions)
      .set({ state: "revoked", version: input.expectedVersion + 1, updatedAt: new Date() })
      .where(and(eq(schema.expenseDecisions.id, input.id), eq(schema.expenseDecisions.ownerId, owner.id), eq(schema.expenseDecisions.version, input.expectedVersion)))
      .returning({ id: schema.expenseDecisions.id });
    if (!res.length) throw new ConflictError("decision", input.id);
    await audit(tx, owner, input.id, "revoke", { state: d.state }, { state: "revoked" });
  });
}

/** Resolve a pending pre-seeded decision by hand to a chosen row. */
export async function pinDecisionTo(db: AnyDb, owner: Owner, input: { id: string; rowKey: string; expectedVersion: number }): Promise<void> {
  await db.transaction(async (tx) => {
    const active = pinnedMap(await loadDecisions(tx, owner)).get(input.rowKey);
    if (active) throw new ConflictError("decision", active.id);
    const res = await tx
      .update(schema.expenseDecisions)
      .set({ state: "pinned", rowKey: input.rowKey, version: input.expectedVersion + 1, updatedAt: new Date() })
      .where(
        and(
          eq(schema.expenseDecisions.id, input.id),
          eq(schema.expenseDecisions.ownerId, owner.id),
          eq(schema.expenseDecisions.version, input.expectedVersion),
          inArray(schema.expenseDecisions.state, ["pending"]),
        ),
      )
      .returning({ id: schema.expenseDecisions.id });
    if (!res.length) throw new ConflictError("decision", input.id);
    await audit(tx, owner, input.id, "pin", { state: "pending" }, { state: "pinned", rowKey: input.rowKey });
  });
}
