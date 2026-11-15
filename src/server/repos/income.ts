import { and, asc, eq, gte, isNull, lte } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { IncomeEntry } from "@/engines/income";
import * as schema from "../db/schema";
import type { Owner } from "../owner-core";
import { ConflictError, NotFoundError } from "./errors";

type AnyDb = NodePgDatabase<typeof schema>;

export type IncomeRecord = IncomeEntry & { version: number };

const toRecord = (r: typeof schema.incomeEntries.$inferSelect): IncomeRecord => ({
  id: r.id,
  date: r.date,
  amountMinor: r.amountMinor,
  employer: r.employer,
  note: r.note,
  version: r.version,
});

export async function listIncome(db: AnyDb, owner: Owner, range: { from?: string; to?: string } = {}): Promise<IncomeRecord[]> {
  const rows = await db
    .select()
    .from(schema.incomeEntries)
    .where(
      and(
        eq(schema.incomeEntries.ownerId, owner.id),
        isNull(schema.incomeEntries.deletedAt),
        range.from ? gte(schema.incomeEntries.date, range.from) : undefined,
        range.to ? lte(schema.incomeEntries.date, range.to) : undefined,
      ),
    )
    .orderBy(asc(schema.incomeEntries.date));
  return rows.map(toRecord);
}

async function audit(db: AnyDb, owner: Owner, id: string, action: string, before: unknown, after: unknown) {
  await db.insert(schema.auditLog).values({ ownerId: owner.id, entity: "income", entityId: id, action, before, after });
}

export interface IncomeInput {
  date: string;
  amountMinor: number;
  employer: string | null;
  note: string | null;
}

export async function addIncome(db: AnyDb, owner: Owner, input: IncomeInput & { idempotencyKey: string }) {
  return db.transaction(async (tx) => {
    const ins = await tx
      .insert(schema.incomeEntries)
      .values({ ownerId: owner.id, ...input, currency: "USD" })
      .onConflictDoNothing({ target: [schema.incomeEntries.ownerId, schema.incomeEntries.idempotencyKey] })
      .returning();
    const row =
      ins[0] ??
      (await tx.select().from(schema.incomeEntries).where(and(eq(schema.incomeEntries.ownerId, owner.id), eq(schema.incomeEntries.idempotencyKey, input.idempotencyKey))))[0]!;
    if (ins.length) await audit(tx, owner, row.id, "create", null, input);
    return toRecord(row);
  });
}

export async function updateIncome(db: AnyDb, owner: Owner, input: IncomeInput & { id: string; expectedVersion: number }) {
  return db.transaction(async (tx) => {
    const { id, expectedVersion, ...values } = input;
    const [prev] = await tx.select().from(schema.incomeEntries).where(and(eq(schema.incomeEntries.id, id), eq(schema.incomeEntries.ownerId, owner.id), isNull(schema.incomeEntries.deletedAt)));
    if (!prev) throw new NotFoundError("paycheck", id);
    const res = await tx
      .update(schema.incomeEntries)
      .set({ ...values, version: expectedVersion + 1, updatedAt: new Date() })
      .where(and(eq(schema.incomeEntries.id, id), eq(schema.incomeEntries.ownerId, owner.id), eq(schema.incomeEntries.version, expectedVersion)))
      .returning();
    if (!res.length) throw new ConflictError("paycheck", id);
    await audit(tx, owner, id, "update", toRecord(prev), values);
    return toRecord(res[0]!);
  });
}

export async function deleteIncome(db: AnyDb, owner: Owner, input: { id: string; expectedVersion: number }) {
  await db.transaction(async (tx) => {
    const res = await tx
      .update(schema.incomeEntries)
      .set({ deletedAt: new Date(), version: input.expectedVersion + 1, updatedAt: new Date() })
      .where(and(eq(schema.incomeEntries.id, input.id), eq(schema.incomeEntries.ownerId, owner.id), eq(schema.incomeEntries.version, input.expectedVersion), isNull(schema.incomeEntries.deletedAt)))
      .returning({ id: schema.incomeEntries.id });
    if (!res.length) throw new ConflictError("paycheck", input.id);
    await audit(tx, owner, input.id, "delete", null, null);
  });
}
