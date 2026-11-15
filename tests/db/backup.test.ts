import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { ScriptDb } from "@/server/db/connect";
import { BACKUP_TABLES, createBackup, decodeBackup, encodeBackup, previewRestore, restoreBackup, type Backup } from "@/server/backup";
import { cell, exportCsv, toCsv } from "@/server/exports";
import { loadMonthView } from "@/server/month-data";
import { resolveOwner, type Owner } from "@/server/owner-core";
import { importCsvFiles } from "@/server/repos/csv-import";
import { UserFacingError } from "@/server/repos/errors";
import { addManualExpense } from "@/server/repos/expenses";
import { addIncome } from "@/server/repos/income";
import { closeMonth, setMonthSource } from "@/server/repos/months";
import { seed } from "@/server/seed";
import { FIXTURE_DIR, fixturesAvailable } from "../../scripts/lib/load-exports";
import { dbAvailable, ENV, openTestDb, OWNER_EMAIL, resetDb } from "./db";

const up = await dbAvailable();

describe("CSV export cells", () => {
  it("quotes commas/quotes/newlines and defuses formulas in text cells only", () => {
    expect(cell('a,"b"')).toBe('"a,""b"""');
    expect(cell("=SUM(A1)", "text")).toBe("'=SUM(A1)");
    expect(cell("-12.50")).toBe("-12.50"); // amounts stay numeric
    expect(toCsv(["a", "b"], [["x", null]])).toBe("a,b\nx,\n");
  });
});

describe.skipIf(!up)("backup & restore (DB)", () => {
  let db: ScriptDb;
  let close: () => Promise<void>;
  let owner: Owner;
  beforeAll(async () => {
    ({ db, close } = await openTestDb());
  });
  afterAll(async () => close?.());
  beforeEach(async () => {
    await resetDb(db);
    await seed(db, { ownerEmail: OWNER_EMAIL });
    owner = await resolveOwner({ user: { email: OWNER_EMAIL } }, db, ENV);
    const groceries = (await db.select().from(schema.categories)).find((c) => c.name === "Groceries")!;
    await addManualExpense(db, owner, { date: "2026-08-10", description: '=cmd, "quoted"', categoryId: groceries.id, amountMinor: 1234, note: "line1\nline2", idempotencyKey: "b-1" });
    await addIncome(db, owner, { date: "2026-08-07", amountMinor: 250000, employer: "Acme", note: null, idempotencyKey: "b-2" });
    await closeMonth(db, owner, { month: "2026-08", expectedVersion: null });
  });

  const counts = async () => Object.fromEntries(await Promise.all(Object.entries(BACKUP_TABLES).map(async ([k, t]) => [k, (await db.select().from(t)).length])));
  const roundTrip = (b: Backup) => decodeBackup(encodeBackup(b));

  it("is versioned, gzip-compressed and decodes back to the same thing", async () => {
    const b = await createBackup(db, owner);
    expect(b).toMatchObject({ format: "tally-backup", version: 1, owner: { email: OWNER_EMAIL } });
    const bytes = encodeBackup(b);
    expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
    expect(roundTrip(b)).toEqual(JSON.parse(JSON.stringify(b)));
    expect(decodeBackup(Buffer.from(JSON.stringify(b)))).toEqual(JSON.parse(JSON.stringify(b))); // plain JSON accepted too
  });

  it("dry run against the same data: everything identical, nothing written", async () => {
    const b = roundTrip(await createBackup(db, owner));
    const before = await counts();
    const p = await previewRestore(db, owner, b);
    expect(p.totals).toEqual({ newRows: 0, different: 0, onlyInDatabase: 0 });
    expect(await counts()).toEqual(before);
  });

  it("replace round-trip: wipe, restore, identical data and the same closed-month total", async () => {
    const b = roundTrip(await createBackup(db, owner));
    const aug = (await loadMonthView(db, owner, "2026-08")).summary!.totalMinor;
    await expect(restoreBackup(db, owner, b, { mode: "replace" })).rejects.toBeInstanceOf(UserFacingError); // needs confirmation
    await restoreBackup(db, owner, b, { mode: "replace", confirm: "REPLACE" });
    const after = roundTrip(await createBackup(db, owner));
    for (const name of Object.keys(BACKUP_TABLES) as (keyof typeof BACKUP_TABLES)[]) {
      if (name === "auditLog") continue; // restore adds its own audit entry
      expect([name, after.tables[name]]).toEqual([name, b.tables[name]]);
    }
    const v = await loadMonthView(db, owner, "2026-08");
    expect(v).toMatchObject({ status: "closed" });
    expect(v.summary!.totalMinor).toBe(aug);
  });

  it("merge adds only what's missing and never overwrites rows that differ", async () => {
    const b = roundTrip(await createBackup(db, owner));
    await db.delete(schema.incomeEntries);
    await db.update(schema.manualExpenses).set({ description: "edited after backup" });
    const p = await previewRestore(db, owner, b);
    expect(p.tables.find((t) => t.table === "incomeEntries")).toMatchObject({ newRows: 1 });
    expect(p.tables.find((t) => t.table === "manualExpenses")).toMatchObject({ different: 1 });
    await restoreBackup(db, owner, b, { mode: "merge" });
    expect(await db.select().from(schema.incomeEntries)).toHaveLength(1);
    expect((await db.select().from(schema.manualExpenses))[0]!.description).toBe("edited after backup");
  });

  it("merge into separately-seeded data refuses cleanly instead of half-applying", async () => {
    const b = roundTrip(await createBackup(db, owner));
    await resetDb(db);
    await seed(db, { ownerEmail: OWNER_EMAIL }); // same names, new ids
    owner = await resolveOwner({ user: { email: OWNER_EMAIL } }, db, ENV);
    const before = await counts();
    await expect(restoreBackup(db, owner, b, { mode: "merge" })).rejects.toThrow(/Use Replace/);
    expect(await counts()).toEqual(before);
    await restoreBackup(db, owner, b, { mode: "replace", confirm: "REPLACE" });
    expect((await loadMonthView(db, owner, "2026-08")).status).toBe("closed");
  });

  it("refuses another account's backup, wrong versions and junk", async () => {
    const b = roundTrip(await createBackup(db, owner));
    await expect(previewRestore(db, owner, { ...b, owner: { ...b.owner, email: "someone@else.test" } })).rejects.toThrow(/different account/);
    expect(() => decodeBackup(Buffer.from(JSON.stringify({ ...b, version: 2 })))).toThrow(/version 2/);
    expect(() => decodeBackup(Buffer.from("not json"))).toThrow(UserFacingError);
    const { tables, ...rest } = b;
    expect(() => decodeBackup(Buffer.from(JSON.stringify({ ...rest, tables: { ...tables, months: undefined } })))).toThrow(/months/);
  });

  it("CSV exports: expenses, income, lender payments, projection", async () => {
    const exp = await exportCsv(db, owner, "expenses");
    expect(exp.split("\n")[0]).toBe("month,date,description,category,my_share_usd,full_cost,currency,group,status,reason,source,month_status");
    expect(exp).toContain(`"'=cmd, ""quoted"""`);
    expect(exp).toContain("2026-08,2026-08-01,Rent,Rent,875.00");
    expect(await exportCsv(db, owner, "income")).toContain("2026-08-07,2500.00,Acme,");
    const pays = await exportCsv(db, owner, "lender-payments");
    expect(pays).toContain("2025-12-11,,9033.00,,bounce,bounced,bounced");
    const proj = await exportCsv(db, owner, "projection");
    expect(proj.split("\n")[1]).toMatch(/^2026-10-11,8826923\.00,11\.55,84959\.13,9846\.00,recorded,/);
    expect(await exportCsv(db, owner, "category-summaries")).toContain("2026-08,Groceries,12.34,detailed");
  });

  describe.skipIf(!fixturesAvailable())("with real CSV imports", () => {
    it("imported files survive a replace round trip and August still reconciles", async () => {
      await resetDb(db);
      await seed(db, { ownerEmail: OWNER_EMAIL });
      owner = await resolveOwner({ user: { email: OWNER_EMAIL } }, db, ENV);
      const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith("_2026-09-16_export.csv")).map((f) => ({ name: f, content: readFileSync(join(FIXTURE_DIR, f), "utf8") }));
      await importCsvFiles(db, owner, files);
      await setMonthSource(db, owner, { month: "2026-08", source: "csv" });
      const b = roundTrip(await createBackup(db, owner));
      await resetDb(db);
      await seed(db, { ownerEmail: OWNER_EMAIL });
      owner = await resolveOwner({ user: { email: OWNER_EMAIL } }, db, ENV);
      await restoreBackup(db, owner, b, { mode: "replace", confirm: "REPLACE" });
      expect((await loadMonthView(db, owner, "2026-08")).summary!.totalMinor).toBe(182167);
    });
  });
});
