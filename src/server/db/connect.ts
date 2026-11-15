/** Connection helper for scripts and tests (no "server-only" guard). */
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "./schema";

export type ScriptDb = NodePgDatabase<typeof schema>;

export function connect(url: string | undefined = process.env.DATABASE_URL): { db: ScriptDb; pool: Pool } {
  if (!url) throw new Error("DATABASE_URL is not set");
  const pool = new Pool({ connectionString: url, max: 3 });
  return { db: drizzle({ client: pool, schema }), pool };
}

export async function runMigrations(db: ScriptDb): Promise<void> {
  await migrate(db, { migrationsFolder: "drizzle" });
}
