import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { tallyPool?: Pool };

function pool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  // One pool per process (survives dev hot reloads).
  // Small pool with short idle timeout: suits serverless (Vercel Fluid) and Neon's pooled endpoint.
  globalForDb.tallyPool ??= new Pool({ connectionString: url, max: 5, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000 });
  return globalForDb.tallyPool;
}

let _db: Db | undefined;
export function getDb(): Db {
  _db ??= drizzle({ client: pool(), schema });
  return _db;
}
