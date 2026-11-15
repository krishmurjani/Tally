// Spec test 8 (DB part): recurring rent/phone added exactly once; an effective-date change doesn't touch past months.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recurringRowsForMonth } from "@/engines/recurring";
import type { ScriptDb } from "@/server/db/connect";
import { resolveOwner, type Owner } from "@/server/owner-core";
import { addRecurringVersion, loadRecurring } from "@/server/repos/recurring";
import { seed } from "@/server/seed";
import { dbAvailable, ENV, openTestDb, OWNER_EMAIL, resetDb } from "./db";

const up = await dbAvailable();

describe.skipIf(!up)("recurring rules from the DB", () => {
  let db: ScriptDb;
  let close: () => Promise<void>;
  let owner: Owner;
  beforeAll(async () => {
    ({ db, close } = await openTestDb());
    await resetDb(db);
    await seed(db, { ownerEmail: OWNER_EMAIL });
    await seed(db, { ownerEmail: OWNER_EMAIL }); // re-seeding must not duplicate rules
    owner = await resolveOwner({ user: { email: OWNER_EMAIL } }, db, ENV);
  });
  afterAll(async () => close?.());

  const rowsFor = async (m: string) => {
    const { rules, overrides } = await loadRecurring(db, owner);
    return recurringRowsForMonth(rules, overrides, m);
  };

  it("rent $875 and phone $25 appear exactly once in Aug 2026", async () => {
    const rows = await rowsFor("2026-08");
    expect(rows.map((r) => [r.description, r.result.shareMinor, r.category])).toEqual([
      ["Phone", 2500, "Phone"],
      ["Rent", 87500, "Rent"],
    ]);
  });

  it("a new rent version from 2027-01 leaves 2026 months untouched", async () => {
    const before = await rowsFor("2026-12");
    await addRecurringVersion(db, owner, { series: "rent", effectiveFrom: "2027-01", amountMinor: 120000 });
    expect(await rowsFor("2026-12")).toEqual(before);
    const jan = await rowsFor("2027-01");
    expect(jan.filter((r) => r.series === "rent").map((r) => r.result.shareMinor)).toEqual([120000]);
  });

  it("the same series can't get two versions for the same month (DB unique constraint)", async () => {
    await expect(addRecurringVersion(db, owner, { series: "rent", effectiveFrom: "2027-01", amountMinor: 1 })).rejects.toThrow();
  });
});
