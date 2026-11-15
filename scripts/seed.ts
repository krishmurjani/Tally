/**
 * Seed Krish's real starting data into DATABASE_URL. Safe to re-run (idempotent).
 * Usage: pnpm seed      (reads OWNER_EMAIL and DATABASE_URL from .env.local)
 */
import { connect } from "../src/server/db/connect";
import { ownerEmailFromEnv } from "../src/server/owner-core";
import { seed } from "../src/server/seed";
import { LOCAL_DECISIONS_FILE, loadLocalDecisions } from "./lib/local-decisions";

const ownerEmail = ownerEmailFromEnv();
const localDecisions = loadLocalDecisions();
const { db, pool } = connect();
try {
  const report = await seed(db, { ownerEmail, localDecisions });
  console.log(`Seeded ${new URL(process.env.DATABASE_URL!).host} (owner from OWNER_EMAIL).`);
  console.log(localDecisions.length ? `Loaded ${localDecisions.length} confirmed decision(s) from ${LOCAL_DECISIONS_FILE}.` : "No local confirmed-decisions file found.");
  for (const [table, r] of Object.entries(report)) console.log(`  ${table.padEnd(16)} ${r.inserted} new / ${r.total} expected`);
} finally {
  await pool.end();
}
