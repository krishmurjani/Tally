/**
 * CSV import (fallback for when the API isn't usable). Files are stored verbatim; month rows are
 * derived at read time so pairwise combination can span files. A month only uses CSV data when its
 * source is set to "csv" — CSV and API rows are never mixed.
 */
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { normalizeExportFileName, parseSplitwiseExport } from "@/engines/csv/parse";
import { deriveCsvMonth } from "@/engines/csv/share";
import * as schema from "../db/schema";
import { loadCsvExports, decisionCandidates } from "../month-data";
import type { Owner } from "../owner-core";
import { loadDecisions, pinPendingForMonth } from "./decisions";
import { flagClosedMonth } from "../splitwise/sync";

type AnyDb = NodePgDatabase<typeof schema>;

export const MAX_CSV_BYTES = 2_000_000;

export type ImportResult =
  | { fileName: string; status: "imported"; source: string; exportDate: string | null; kind: string; rows: number; unreadableRows: number }
  | { fileName: string; status: "duplicate"; source: string }
  | { fileName: string; status: "error"; message: string };

export async function importCsvFiles(db: AnyDb, owner: Owner, files: { name: string; content: string }[]): Promise<ImportResult[]> {
  const names = files.map((f) => normalizeExportFileName(f.name));
  const clash = names.find((n, i) => names.indexOf(n) !== i);
  if (clash) return files.map((f) => ({ fileName: f.name, status: "error", message: `Two files would both be named ${clash} — import them separately.` }));

  return db.transaction(async (tx) => {
    const results: ImportResult[] = [];
    for (const [i, f] of files.entries()) {
      const fileName = names[i]!;
      if (f.content.length > MAX_CSV_BYTES) {
        results.push({ fileName, status: "error", message: "File is too large for a Splitwise export." });
        continue;
      }
      let parsed;
      try {
        parsed = parseSplitwiseExport(fileName, f.content);
      } catch (e) {
        results.push({ fileName, status: "error", message: (e as Error).message });
        continue;
      }
      const sha256 = createHash("sha256").update(f.content).digest("hex");
      const [same] = await tx.select().from(schema.csvImports).where(and(eq(schema.csvImports.ownerId, owner.id), eq(schema.csvImports.sha256, sha256)));
      if (same) {
        results.push({ fileName, status: "duplicate", source: parsed.source });
        continue;
      }
      if (parsed.exportDate) {
        const [sameDate] = await tx
          .select()
          .from(schema.csvImports)
          .where(and(eq(schema.csvImports.ownerId, owner.id), eq(schema.csvImports.source, parsed.source), eq(schema.csvImports.exportDate, parsed.exportDate)));
        if (sameDate) {
          results.push({ fileName, status: "error", message: `A different ${parsed.source} export dated ${parsed.exportDate} is already imported. Which one is right?` });
          continue;
        }
      }
      await tx.insert(schema.csvImports).values({
        ownerId: owner.id,
        fileName,
        source: parsed.source,
        exportDate: parsed.exportDate,
        sha256,
        rowCount: parsed.transactions.length,
        content: f.content,
      });
      results.push({
        fileName,
        status: "imported",
        source: parsed.source,
        exportDate: parsed.exportDate,
        kind: parsed.kind,
        rows: parsed.transactions.length,
        unreadableRows: parsed.problems.length,
      });
    }
    await refreshCsvMonths(tx, owner);
    return results;
  });
}

/** Pin pending decisions and flag closed months, for every month whose source is CSV. */
export async function refreshCsvMonths(db: AnyDb, owner: Owner): Promise<void> {
  const csvMonths = await db
    .select()
    .from(schema.months)
    .where(and(eq(schema.months.ownerId, owner.id), eq(schema.months.dataSource, "csv")));
  if (!csvMonths.length) return;
  const exports = await loadCsvExports(db, owner);
  const pendingMonths = new Set((await loadDecisions(db, owner)).filter((d) => d.state === "pending" && d.matchSpec).map((d) => d.matchSpec!.date.slice(0, 7)));
  for (const m of csvMonths) {
    if (pendingMonths.has(m.month) && exports.length) {
      await pinPendingForMonth(db, owner, m.month, decisionCandidates(deriveCsvMonth(exports, m.month).rows));
    }
    await flagClosedMonth(db, owner, m.month);
  }
}

export async function listCsvImports(db: AnyDb, owner: Owner) {
  return db
    .select({
      id: schema.csvImports.id,
      fileName: schema.csvImports.fileName,
      source: schema.csvImports.source,
      exportDate: schema.csvImports.exportDate,
      rowCount: schema.csvImports.rowCount,
      importedAt: schema.csvImports.importedAt,
    })
    .from(schema.csvImports)
    .where(eq(schema.csvImports.ownerId, owner.id));
}
