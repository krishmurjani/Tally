import { fixturesAvailable, FIXTURE_DIR } from "../scripts/lib/load-exports";

/** Make a missing-fixtures run impossible to mistake for a passing reconciliation. */
export default function setup() {
  if (!fixturesAvailable()) {
    process.stderr.write(
      `\n⚠ SKIPPED: fixture reconciliation tests — no *_export.csv in ${FIXTURE_DIR}. August/September reconciliation is NOT verified in this run.\n\n`,
    );
  }
}
