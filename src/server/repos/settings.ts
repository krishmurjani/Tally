import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import type { Owner } from "../owner-core";
import { ConflictError, NotFoundError } from "./errors";

type AnyDb = NodePgDatabase<typeof schema>;

export interface OwnerSettings {
  email: string;
  largeExpenseThresholdMinor: number;
  splitwiseUserId: number | null;
  version: number;
}

export async function getSettings(db: AnyDb, owner: Owner): Promise<OwnerSettings> {
  const [row] = await db.select().from(schema.owners).where(eq(schema.owners.id, owner.id)).limit(1);
  if (!row) throw new NotFoundError("owner", owner.id);
  return {
    email: row.email,
    largeExpenseThresholdMinor: row.settings.largeExpenseThresholdMinor,
    splitwiseUserId: row.splitwiseUserId,
    version: row.version,
  };
}

/** Optimistic concurrency: only updates if `expectedVersion` still matches. */
export async function updateLargeThreshold(
  db: AnyDb,
  owner: Owner,
  input: { thresholdMinor: number; expectedVersion: number },
): Promise<OwnerSettings> {
  return db.transaction(async (tx) => {
    const current = await getSettings(tx, owner);
    const updated = await tx
      .update(schema.owners)
      .set({
        settings: { largeExpenseThresholdMinor: input.thresholdMinor },
        version: input.expectedVersion + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.owners.id, owner.id), eq(schema.owners.version, input.expectedVersion)))
      .returning({ id: schema.owners.id });
    if (updated.length === 0) throw new ConflictError("settings", owner.id);
    await tx.insert(schema.auditLog).values({
      ownerId: owner.id,
      entity: "settings",
      entityId: owner.id,
      action: "update",
      before: { largeExpenseThresholdMinor: current.largeExpenseThresholdMinor },
      after: { largeExpenseThresholdMinor: input.thresholdMinor },
    });
    return getSettings(tx, owner);
  });
}
