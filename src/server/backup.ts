/**
 * Versioned backup of everything an owner has, and restore with a dry-run preview.
 * Restore never silently overwrites:
 *   - "merge" inserts only rows whose id isn't present; rows that differ are listed and left alone.
 *   - "replace" deletes this owner's data and loads the backup — only with an explicit confirmation.
 */
import { gunzipSync, gzipSync } from "node:zlib";
import { eq, getTableColumns, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import * as schema from "./db/schema";
import { normalizeEmail, type Owner } from "./owner-core";
import { canonicalJson } from "./splitwise/derive";
import { UserFacingError } from "./repos/errors";

type AnyDb = NodePgDatabase<typeof schema>;

export const BACKUP_FORMAT = "tally-backup";
export const BACKUP_VERSION = 1;

/** Parents before children (FK order). Every table here has an owner_id column. */
export const BACKUP_TABLES = {
  categories: schema.categories,
  budgetDefaults: schema.budgetDefaults,
  monthBudgets: schema.monthBudgets,
  splitwiseCategoryMaps: schema.splitwiseCategoryMaps,
  keywordRules: schema.keywordRules,
  splitwiseExpenses: schema.splitwiseExpenses,
  csvImports: schema.csvImports,
  expenseDecisions: schema.expenseDecisions,
  categoryOverrides: schema.categoryOverrides,
  usdConfirmations: schema.usdConfirmations,
  manualExpenses: schema.manualExpenses,
  recurringRules: schema.recurringRules,
  recurringOverrides: schema.recurringOverrides,
  months: schema.months,
  incomeEntries: schema.incomeEntries,
  historySummaries: schema.historySummaries,
  loans: schema.loans,
  loanRates: schema.loanRates,
  loanDisbursements: schema.loanDisbursements,
  loanSchedules: schema.loanSchedules,
  lenderPayments: schema.lenderPayments,
  sisterReimbursements: schema.sisterReimbursements,
  payoffScenarios: schema.payoffScenarios,
  auditLog: schema.auditLog,
} as const;

export type BackupTable = keyof typeof BACKUP_TABLES;
type Row = Record<string, unknown> & { id: string };

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  owner: { email: string; settings: unknown; splitwiseUserId: number | null };
  tables: Record<BackupTable, Row[]>;
}

type OwnedTable = PgTable & { ownerId: PgColumn; id: PgColumn };
const table = (name: BackupTable) => BACKUP_TABLES[name] as unknown as OwnedTable;

/** JSON-safe row: Dates → ISO strings. */
function plain(row: Record<string, unknown>): Row {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? v.toISOString() : v;
  return out as Row;
}

export async function createBackup(db: AnyDb, owner: Owner, now = new Date()): Promise<Backup> {
  const [o] = await db.select().from(schema.owners).where(eq(schema.owners.id, owner.id));
  if (!o) throw new UserFacingError("Owner not found");
  const tables = {} as Record<BackupTable, Row[]>;
  for (const name of Object.keys(BACKUP_TABLES) as BackupTable[]) {
    const t = table(name);
    const rows = (await db.select().from(t).where(eq(t.ownerId, owner.id))) as Record<string, unknown>[];
    tables[name] = rows
      .map((r) => {
        const { ownerId: _o, ...rest } = plain(r);
        // sync runs aren't backed up; drop the link so restore never points at a missing run
        if (name === "splitwiseExpenses") rest.lastSeenSyncId = null;
        return rest as Row;
      })
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    owner: { email: o.email, settings: o.settings, splitwiseUserId: o.splitwiseUserId },
    tables,
  };
}

export function encodeBackup(b: Backup): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(b)));
}

/** Accepts gzip or plain JSON bytes. Validates the envelope; rows are checked against the schema on insert. */
export function decodeBackup(bytes: Uint8Array): Backup {
  let text: string;
  try {
    const buf = Buffer.from(bytes);
    text = (buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString("utf8");
  } catch {
    throw new UserFacingError("That file isn't a Tally backup (couldn't decompress it).");
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new UserFacingError("That file isn't a Tally backup (not valid JSON).");
  }
  const b = data as Partial<Backup>;
  if (b.format !== BACKUP_FORMAT) throw new UserFacingError("That file isn't a Tally backup.");
  if (b.version !== BACKUP_VERSION) throw new UserFacingError(`Backup version ${String(b.version)} isn't supported by this version of Tally (expects ${BACKUP_VERSION}).`);
  if (!b.owner?.email || !b.tables || typeof b.tables !== "object") throw new UserFacingError("The backup is incomplete.");
  for (const name of Object.keys(BACKUP_TABLES) as BackupTable[]) {
    const rows = (b.tables as Record<string, unknown>)[name];
    if (!Array.isArray(rows)) throw new UserFacingError(`The backup is missing the ${name} table.`);
    if (rows.some((r) => !r || typeof r !== "object" || typeof (r as Row).id !== "string")) throw new UserFacingError(`The backup's ${name} table has rows without ids.`);
  }
  return b as Backup;
}

export interface TablePreview {
  table: BackupTable;
  inBackup: number;
  inDatabase: number;
  /** In the backup, not in the DB (merge would add these). */
  newRows: number;
  identical: number;
  /** Same id, different content (merge leaves these alone; replace takes the backup's). */
  different: number;
  /** In the DB, not in the backup (replace would delete these). */
  onlyInDatabase: number;
}

export interface RestorePreview {
  backupEmail: string;
  exportedAt: string;
  tables: TablePreview[];
  totals: { newRows: number; different: number; onlyInDatabase: number };
}

const comparable = (r: Record<string, unknown>) => {
  const { ownerId: _o, lastSeenSyncId: _l, ...rest } = plain(r);
  return canonicalJson(rest);
};

function assertSameOwner(b: Backup, owner: Owner) {
  if (normalizeEmail(b.owner.email) !== normalizeEmail(owner.email)) {
    throw new UserFacingError("This backup belongs to a different account — it can't be restored here.");
  }
}

/** Dry run: what would change. Writes nothing. */
export async function previewRestore(db: AnyDb, owner: Owner, b: Backup): Promise<RestorePreview> {
  assertSameOwner(b, owner);
  const tables: TablePreview[] = [];
  for (const name of Object.keys(BACKUP_TABLES) as BackupTable[]) {
    const t = table(name);
    const current = (await db.select().from(t).where(eq(t.ownerId, owner.id))) as Row[];
    const byId = new Map(current.map((r) => [r.id, comparable(r)]));
    const backupIds = new Set(b.tables[name].map((r) => r.id));
    let newRows = 0;
    let identical = 0;
    let different = 0;
    for (const r of b.tables[name]) {
      const cur = byId.get(r.id);
      if (cur === undefined) newRows++;
      else if (cur === comparable(r)) identical++;
      else different++;
    }
    tables.push({ table: name, inBackup: b.tables[name].length, inDatabase: current.length, newRows, identical, different, onlyInDatabase: current.filter((r) => !backupIds.has(r.id)).length });
  }
  return {
    backupEmail: b.owner.email,
    exportedAt: b.exportedAt,
    tables,
    totals: {
      newRows: tables.reduce((s, t) => s + t.newRows, 0),
      different: tables.reduce((s, t) => s + t.different, 0),
      onlyInDatabase: tables.reduce((s, t) => s + t.onlyInDatabase, 0),
    },
  };
}

/** Convert a backup row for insert: owner remapped, ISO strings → Date for timestamp columns. */
function forInsert(name: BackupTable, r: Row, ownerId: string): Record<string, unknown> {
  const cols = getTableColumns(BACKUP_TABLES[name]) as Record<string, { columnType: string }>;
  const out: Record<string, unknown> = { ownerId };
  for (const [k, v] of Object.entries(r)) {
    if (!(k in cols)) throw new UserFacingError(`The backup's ${name} table has an unknown field "${k}".`);
    out[k] = cols[k]!.columnType === "PgTimestamp" && typeof v === "string" ? new Date(v) : v;
  }
  return out;
}

export const REPLACE_CONFIRMATION = "REPLACE";

export async function restoreBackup(db: AnyDb, owner: Owner, b: Backup, opts: { mode: "merge" | "replace"; confirm?: string }) {
  assertSameOwner(b, owner);
  if (opts.mode === "replace" && opts.confirm !== REPLACE_CONFIRMATION) {
    throw new UserFacingError(`Type ${REPLACE_CONFIRMATION} to confirm replacing all your data with the backup.`);
  }
  try {
    return await runRestore(db, owner, b, opts.mode);
  } catch (e) {
    if (e instanceof UserFacingError || opts.mode === "replace") throw e;
    // Merge into data that was created separately (different ids for the same category names, etc.)
    throw new UserFacingError("Some backup rows conflict with existing data (for example a category with the same name but a different id). Nothing was changed. Use Replace to load the backup as a whole.");
  }
}

async function runRestore(db: AnyDb, owner: Owner, b: Backup, mode: "merge" | "replace") {
  const opts = { mode };
  return db.transaction(async (tx) => {
    const names = Object.keys(BACKUP_TABLES) as BackupTable[];
    if (opts.mode === "replace") {
      for (const name of [...names].reverse()) {
        const t = table(name);
        await tx.delete(t).where(eq(t.ownerId, owner.id));
      }
    }
    const inserted: Partial<Record<BackupTable, number>> = {};
    for (const name of names) {
      const t = table(name);
      let rows = b.tables[name];
      if (opts.mode === "merge" && rows.length) {
        const existing = new Set(
          ((await tx.select({ id: t.id }).from(t).where(inArray(t.id, rows.map((r) => r.id)))) as { id: string }[]).map((r) => r.id),
        );
        rows = rows.filter((r) => !existing.has(r.id));
      }
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200).map((r) => forInsert(name, r, owner.id));
        // No ON CONFLICT: any clash aborts the whole restore rather than half-applying it.
        await tx.insert(BACKUP_TABLES[name]).values(chunk as never);
      }
      inserted[name] = rows.length;
    }
    await tx
      .update(schema.owners)
      .set({ settings: b.owner.settings as { largeExpenseThresholdMinor: number }, ...(opts.mode === "replace" ? { splitwiseUserId: b.owner.splitwiseUserId } : {}), updatedAt: new Date() })
      .where(eq(schema.owners.id, owner.id));
    await tx.insert(schema.auditLog).values({ ownerId: owner.id, entity: "backup", entityId: b.exportedAt, action: `restore_${opts.mode}`, before: null, after: inserted });
    return inserted;
  });
}
