/** Dev-only loader for the private Splitwise CSV fixtures (fixtures/private, gitignored). */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseSplitwiseExport, type ParsedExport } from "../../src/engines/csv/parse";

export const FIXTURE_DIR = process.env.TALLY_FIXTURE_DIR ?? resolve(import.meta.dirname, "../../fixtures/private");

export function fixturesAvailable(): boolean {
  return existsSync(FIXTURE_DIR) && readdirSync(FIXTURE_DIR).some((f) => f.endsWith("_export.csv"));
}

/** Load exports; with `exportDate`, only files exported on that date. */
export function loadExports(opts: { exportDate?: string; dir?: string } = {}): ParsedExport[] {
  const dir = opts.dir ?? FIXTURE_DIR;
  return readdirSync(dir)
    .filter((f) => f.endsWith("_export.csv"))
    .filter((f) => !opts.exportDate || f.includes(`_${opts.exportDate}_`))
    .sort()
    .map((f) => parseSplitwiseExport(f, readFileSync(join(dir, f), "utf8")));
}
