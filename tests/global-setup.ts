import { fixturesAvailable, FIXTURE_DIR } from "../scripts/lib/load-exports";
import { dbAvailable, TEST_DATABASE_URL } from "./db/db";

/** Make a missing-fixtures run impossible to mistake for a passing reconciliation. */
export default async function setup() {
  if (!(await dbAvailable())) {
    const u = new URL(TEST_DATABASE_URL);
    process.stderr.write(`\n⚠ SKIPPED: database tests — can't reach ${u.host}${u.pathname}. Auth/seed/recurring DB checks are NOT verified in this run.\n\n`);
  }
  if (!fixturesAvailable()) {
    process.stderr.write(
      `\n⚠ SKIPPED: fixture reconciliation tests — no *_export.csv in ${FIXTURE_DIR}. August/September reconciliation is NOT verified in this run.\n\n`,
    );
  }
}
