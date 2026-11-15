/**
 * Restore a backup. Dry run by default — prints what would change and writes nothing.
 * Usage:
 *   pnpm restore backups/tally-backup-2026-11-15.json.gz              # dry run
 *   pnpm restore <file> --merge                                       # add missing rows only
 *   pnpm restore <file> --replace --yes                               # delete current data, load backup
 */
import { readFileSync } from "node:fs";
import { decodeBackup, previewRestore, REPLACE_CONFIRMATION, restoreBackup } from "../src/server/backup";
import { connect } from "../src/server/db/connect";
import { ownerEmailFromEnv, resolveOwner } from "../src/server/owner-core";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("Usage: pnpm restore <backup.json.gz> [--merge | --replace --yes]");
  process.exit(1);
}
const mode = args.includes("--replace") ? "replace" : args.includes("--merge") ? "merge" : null;
const { db, pool } = connect();
try {
  const owner = await resolveOwner({ user: { email: ownerEmailFromEnv() } }, db);
  const backup = decodeBackup(readFileSync(file));
  const p = await previewRestore(db, owner, backup);
  console.log(`Backup from ${p.exportedAt} → ${new URL(process.env.DATABASE_URL!).host}`);
  for (const t of p.tables.filter((x) => x.inBackup || x.inDatabase)) {
    console.log(`  ${t.table.padEnd(22)} backup ${String(t.inBackup).padStart(5)}  now ${String(t.inDatabase).padStart(5)}  new ${String(t.newRows).padStart(5)}  different ${String(t.different).padStart(4)}  only-now ${String(t.onlyInDatabase).padStart(4)}`);
  }
  if (!mode) {
    console.log("\nDry run only. Re-run with --merge (add missing rows) or --replace --yes (replace everything).");
  } else if (mode === "replace" && !args.includes("--yes")) {
    console.log("\n--replace deletes current data. Add --yes to confirm.");
  } else {
    const r = await restoreBackup(db, owner, backup, { mode, confirm: REPLACE_CONFIRMATION });
    console.log(`\nRestored (${mode}): ${Object.values(r).reduce((s, n) => s + (n ?? 0), 0)} rows inserted.`);
  }
} finally {
  await pool.end();
}
