/**
 * Owner resolution — the single gate for every data access. Pure apart from one DB lookup,
 * so it can be tested without Next.js or Auth.js.
 */
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./db/schema";

export interface Owner {
  readonly id: string;
  readonly email: string;
}

export class UnauthorizedError extends Error {
  constructor(message = "Not signed in as the owner") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function ownerEmailFromEnv(env: Record<string, string | undefined> = process.env): string {
  const e = env.OWNER_EMAIL?.trim();
  if (!e) throw new Error("OWNER_EMAIL is not set");
  return normalizeEmail(e);
}

/** Fails closed: a missing OWNER_EMAIL rejects everyone. */
export function isOwnerEmail(email: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  if (!email) return false;
  try {
    return normalizeEmail(email) === ownerEmailFromEnv(env);
  } catch {
    return false;
  }
}

export interface SessionLike {
  user?: { email?: string | null } | null;
}

type AnyDb = NodePgDatabase<typeof schema>;

export async function resolveOwner(
  session: SessionLike | null | undefined,
  db: AnyDb,
  env: Record<string, string | undefined> = process.env,
): Promise<Owner> {
  const email = session?.user?.email;
  if (!email) throw new UnauthorizedError();
  if (!isOwnerEmail(email, env)) throw new UnauthorizedError("This account is not allowed");
  const [row] = await db
    .select({ id: schema.owners.id, email: schema.owners.email })
    .from(schema.owners)
    .where(eq(schema.owners.email, normalizeEmail(email)))
    .limit(1);
  if (!row) throw new Error("Owner record not found — run `pnpm seed` first");
  return Object.freeze({ id: row.id, email: row.email });
}
