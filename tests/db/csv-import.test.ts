import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { ScriptDb } from "@/server/db/connect";
import { loadMonthView } from "@/server/month-data";
import { resolveOwner, type Owner } from "@/server/owner-core";
import { importCsvFiles } from "@/server/repos/csv-import";
import { setMonthSource } from "@/server/repos/months";
import { seed } from "@/server/seed";
import { syncMonth, SourceConflictError } from "@/server/splitwise/sync";
import { FIXTURE_DIR, fixturesAvailable } from "../../scripts/lib/load-exports";
import { loadLocalDecisions } from "../../scripts/lib/local-decisions";
import { AUGUST_2026 } from "../../scripts/lib/targets";
import { FakeSplitwise } from "../server/fake-splitwise";
import { dbAvailable, ENV, openTestDb, OWNER_EMAIL, resetDb } from "./db";

const up = await dbAvailable();
const synthetic = [
  "Date,Description,Category,Cost,Currency,Alice,Krish Murjani",
  "2026-08-03,Groceries,Groceries,30.00,USD,-15.00,15.00",
  "2026-08-04,Dinner,Dining out,20.00,USD,10.00,-10.00",
  "2026-09-16,Total balance, , ,USD,0.00,0.00",
].join("\n");

describe.skipIf(!up)("CSV import (DB)", () => {
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
  });

  it("imports, dedupes identical files, and normalizes downloaded names", async () => {
    const r1 = await importCsvFiles(db, owner, [{ name: "1794715392459_house_2026-09-16_export (1).csv", content: synthetic }]);
    expect(r1[0]).toMatchObject({ status: "imported", fileName: "house_2026-09-16_export.csv", rows: 2 });
    const r2 = await importCsvFiles(db, owner, [{ name: "house_2026-09-16_export.csv", content: synthetic }]);
    expect(r2[0]!.status).toBe("duplicate");
    expect(await db.select().from(schema.csvImports)).toHaveLength(1);
  });

  it("stops and asks when a different file has the same source and date", async () => {
    await importCsvFiles(db, owner, [{ name: "house_2026-09-16_export.csv", content: synthetic }]);
    const r = await importCsvFiles(db, owner, [{ name: "house_2026-09-16_export.csv", content: synthetic.replace("30.00", "31.00") }]);
    expect(r[0]).toMatchObject({ status: "error" });
  });

  it("rejects files that aren't Splitwise exports", async () => {
    const r = await importCsvFiles(db, owner, [{ name: "bank.csv", content: "a,b,c\n1,2,3" }]);
    expect(r[0]!.status).toBe("error");
  });

  it("a month only uses CSV once its source is set to CSV — and then sync refuses to mix", async () => {
    await importCsvFiles(db, owner, [{ name: "house_2026-09-16_export.csv", content: synthetic }]);
    expect((await loadMonthView(db, owner, "2026-08")).hasData).toBe(false);
    await setMonthSource(db, owner, { month: "2026-08", source: "csv" });
    const v = await loadMonthView(db, owner, "2026-08");
    expect(v.summary!.totalMinor).toBe(1500 + 1000 + 87500 + 2500);
    await expect(syncMonth(db, owner, new FakeSplitwise(), "2026-08")).rejects.toBeInstanceOf(SourceConflictError);
  });

  describe.skipIf(!fixturesAvailable())("with Krish's real exports", () => {
    const files = () =>
      readdirSync(FIXTURE_DIR)
        .filter((f) => f.endsWith("_2026-09-16_export.csv"))
        .map((f) => ({ name: f, content: readFileSync(join(FIXTURE_DIR, f), "utf8") }));

    it("August 2026 through the DB = $1,821.67 with the spec's categories", async () => {
      const res = await importCsvFiles(db, owner, files());
      expect(res.filter((r) => r.status === "imported")).toHaveLength(7);
      await setMonthSource(db, owner, { month: "2026-08", source: "csv" });
      const v = await loadMonthView(db, owner, "2026-08");
      expect(v.summary!.totalMinor).toBe(AUGUST_2026.totalMinor);
      const byCat = Object.fromEntries(v.summary!.byCategory.filter((c) => c.actualMinor).map((c) => [c.category, c.actualMinor]));
      expect(byCat).toEqual(AUGUST_2026.byCategory);
      expect(v.summary!.counts.review).toBe(0);
    });

    it("September: the two Varun pre-seeds pin when the month switches to CSV", async () => {
      await importCsvFiles(db, owner, files());
      await setMonthSource(db, owner, { month: "2026-09", source: "csv" });
      const pinned = await db.select().from(schema.expenseDecisions).where(eq(schema.expenseDecisions.state, "pinned"));
      expect(pinned).toHaveLength(2);
      const v = await loadMonthView(db, owner, "2026-09");
      expect(v.rows.filter((r) => r.reason === "not_an_expense")).toHaveLength(2);
      expect(v.csv!.partial.length).toBeGreaterThan(0);
    });

    it("local confirmed decisions seed and pin too", async () => {
      const local = loadLocalDecisions();
      await resetDb(db);
      await seed(db, { ownerEmail: OWNER_EMAIL, localDecisions: local });
      owner = await resolveOwner({ user: { email: OWNER_EMAIL } }, db, ENV);
      await importCsvFiles(db, owner, files());
      for (const m of new Set(local.map((d) => d.date.slice(0, 7)))) await setMonthSource(db, owner, { month: m, source: "csv" });
      const states = await db.select().from(schema.expenseDecisions).where(eq(schema.expenseDecisions.origin, "local"));
      expect(states.every((d) => d.state === "pinned")).toBe(true);
    });
  });
});
