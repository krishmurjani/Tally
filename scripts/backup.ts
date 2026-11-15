/**
 * Write a full backup to backups/tally-backup-<date>.json.gz (gitignored). No size limit.
 * Usage: pnpm backup        (uses DATABASE_URL and OWNER_EMAIL from .env.local)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { todayNY } from "../src/engines/dates";
import { createBackup, encodeBackup } from "../src/server/backup";
import { connect } from "../src/server/db/connect";
import { ownerEmailFromEnv, resolveOwner } from "../src/server/owner-core";

const { db, pool } = connect();
try {
  const owner = await resolveOwner({ user: { email: ownerEmailFromEnv() } }, db);
  const b = await createBackup(db, owner);
  mkdirSync("backups", { recursive: true });
  const file = join("backups", `tally-backup-${todayNY()}.json.gz`);
  writeFileSync(file, encodeBackup(b), { mode: 0o600 });
  const rows = Object.values(b.tables).reduce((s, t) => s + t.length, 0);
  console.log(`Wrote ${file} (${rows} rows from ${new URL(process.env.DATABASE_URL!).host}).`);
} finally {
  await pool.end();
}
