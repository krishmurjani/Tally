/** Throwaway Postgres for integration tests (default: local tally_test). Never point this at real data. */
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { connect, runMigrations, type ScriptDb } from "@/server/db/connect";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/tally_test";

if (/neon\.tech|vercel|amazonaws/.test(TEST_DATABASE_URL) || !/test/.test(new URL(TEST_DATABASE_URL).pathname)) {
  throw new Error(`Refusing to run DB tests against ${new URL(TEST_DATABASE_URL).host}${new URL(TEST_DATABASE_URL).pathname} — the database name must contain "test".`);
}

export async function dbAvailable(): Promise<boolean> {
  const p = new Pool({ connectionString: TEST_DATABASE_URL, connectionTimeoutMillis: 1500 });
  try {
    await p.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await p.end();
  }
}

export async function openTestDb(): Promise<{ db: ScriptDb; close: () => Promise<void> }> {
  const { db, pool } = connect(TEST_DATABASE_URL);
  await runMigrations(db);
  return { db, close: () => pool.end() };
}

/** Wipe all data (every table hangs off owners with ON DELETE CASCADE, plus sync_runs). */
export async function resetDb(db: ScriptDb): Promise<void> {
  await db.execute(sql`truncate table owners, sync_runs restart identity cascade`);
}

export const OWNER_EMAIL = "owner@example.test";
export const ENV = { OWNER_EMAIL };
