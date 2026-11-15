import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { shortDate, longDate } from "@/engines/dates";
import * as schema from "@/server/db/schema";
import type { ScriptDb } from "@/server/db/connect";
import { loadMonthView } from "@/server/month-data";
import { resolveOwner, type Owner } from "@/server/owner-core";
import { ConflictError } from "@/server/repos/errors";
import { addManualExpense } from "@/server/repos/expenses";
import { addIncome, listIncome, updateIncome } from "@/server/repos/income";
import { closeMonth, reopenMonth } from "@/server/repos/months";
import { seed } from "@/server/seed";
import { dbAvailable, ENV, openTestDb, OWNER_EMAIL, resetDb } from "./db";

const up = await dbAvailable();

describe("short and long dates", () => {
  it("formats like Jul. 27 (May has no period)", () => {
    expect(shortDate("2026-07-27")).toBe("Jul. 27");
    expect(shortDate("2026-05-03")).toBe("May 3");
    expect(shortDate("2026-09-01")).toBe("Sep. 1");
    expect(longDate("2026-07-30")).toBe("Jul. 30, 2026");
  });
});

describe.skipIf(!up)("reopen a closed month and income sources (DB)", () => {
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
  const groceries = async () => (await db.select().from(schema.categories)).find((c) => c.name === "Groceries")!.id;
  const rec = async () => (await db.select().from(schema.months).where(eq(schema.months.month, "2026-08")))[0]!;

  it("reopening discards the snapshot, makes the month editable, and it can be closed again", async () => {
    await addManualExpense(db, owner, { date: "2026-08-10", description: "x", categoryId: await groceries(), amountMinor: 1000, note: null, idempotencyKey: "r-1" });
    await closeMonth(db, owner, { month: "2026-08", expectedVersion: null });
    expect((await loadMonthView(db, owner, "2026-08")).status).toBe("closed");

    const closedVersion = (await rec()).version;
    await expect(reopenMonth(db, owner, { month: "2026-08", expectedVersion: closedVersion - 1 })).rejects.toBeInstanceOf(ConflictError);
    await reopenMonth(db, owner, { month: "2026-08", expectedVersion: closedVersion });
    const open = await rec();
    expect(open).toMatchObject({ status: "open", snapshot: null, closedAt: null, pendingChanges: null });
    expect((await loadMonthView(db, owner, "2026-08")).status).toBe("open");

    // changes apply again, then it can be closed with the new numbers
    await addManualExpense(db, owner, { date: "2026-08-11", description: "y", categoryId: await groceries(), amountMinor: 500, note: null, idempotencyKey: "r-2" });
    const snap = await closeMonth(db, owner, { month: "2026-08", expectedVersion: open.version });
    expect(snap.totalMinor).toBe(1000 + 500 + 87500 + 2500);
    await expect(reopenMonth(db, owner, { month: "2026-07", expectedVersion: 1 })).rejects.toThrow();
  });

  it("income has a source type: employer (UNYT) by default, plus cash, gifts and other", async () => {
    const a = await addIncome(db, owner, { date: "2026-08-07", amountMinor: 250000, employer: "UNYT", note: null, idempotencyKey: "i-1" });
    const b = await addIncome(db, owner, { date: "2026-08-09", amountMinor: 5000, sourceType: "gift_family", employer: "Mom", note: "birthday", idempotencyKey: "i-2" });
    await addIncome(db, owner, { date: "2026-08-12", amountMinor: 2500, sourceType: "gift_card", employer: null, note: null, idempotencyKey: "i-3" });
    await addIncome(db, owner, { date: "2026-08-13", amountMinor: 4000, sourceType: "cash", employer: null, note: null, idempotencyKey: "i-4" });
    expect(a.sourceType).toBe("employer");
    expect((await listIncome(db, owner)).map((e) => e.sourceType)).toEqual(["employer", "gift_family", "gift_card", "cash"]);
    // every source counts toward the month's income
    expect((await loadMonthView(db, owner, "2026-08")).income.totalMinor).toBe(250000 + 5000 + 2500 + 4000);
    const u = await updateIncome(db, owner, { id: b.id, expectedVersion: b.version, date: "2026-08-09", amountMinor: 5000, sourceType: "other", employer: "Refund", note: null });
    expect(u.sourceType).toBe("other");
  });
});
