// Spec tests 2, 3, 4 against the DB with a fake Splitwise API (synthetic data only).
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { ScriptDb } from "@/server/db/connect";
import { loadMonthView } from "@/server/month-data";
import { resolveOwner, type Owner } from "@/server/owner-core";
import { markNotExpense, revokeDecision } from "@/server/repos/decisions";
import { setLargeDismissed } from "@/server/repos/expenses";
import { acceptChanges, closeMonth, ClosingBlockedError, keepSnapshot } from "@/server/repos/months";
import { seed } from "@/server/seed";
import { syncChanges, syncMonth } from "@/server/splitwise/sync";
import { FakeSplitwise, FRIEND, makeExpense, ME } from "../server/fake-splitwise";
import { dbAvailable, ENV, openTestDb, OWNER_EMAIL, resetDb } from "./db";

const up = await dbAvailable();

describe.skipIf(!up)("Splitwise sync (DB)", () => {
  let db: ScriptDb;
  let close: () => Promise<void>;
  let owner: Owner;
  let sw: FakeSplitwise;

  beforeAll(async () => {
    ({ db, close } = await openTestDb());
  });
  afterAll(async () => close?.());
  beforeEach(async () => {
    await resetDb(db);
    await seed(db, { ownerEmail: OWNER_EMAIL });
    owner = await resolveOwner({ user: { email: OWNER_EMAIL } }, db, ENV);
    sw = new FakeSplitwise();
    sw.expenses = [
      makeExpense({ id: 1, description: "Groceries run", myOwed: "12.50" }),
      makeExpense({ id: 2, description: "Dinner", category: { id: 2, name: "Dining out" }, myOwed: "30.00", date: "2026-08-20T23:30:00Z" }),
      makeExpense({ id: 3, description: "Prathamesh A. paid Krish M.", payment: true, myOwed: "40.00" }),
      makeExpense({ id: 4, description: "I paid for everyone", myOwed: "0.00", myPaid: "20.00" }),
      makeExpense({ id: 5, description: "Late night", myOwed: "5.00", date: "2026-09-01T02:00:00Z" }), // Aug 31 in New York
    ];
  });

  const view = (m = "2026-08") => loadMonthView(db, owner, m);
  const total = async (m = "2026-08") => (await view(m)).summary?.totalMinor;

  it("derives my owed share, the New York date, and includes rent + phone", async () => {
    const r = await syncMonth(db, owner, sw, "2026-08");
    expect(r).toMatchObject({ inserted: 5, updated: 0, unchanged: 0, missing: 0 });
    const v = await view();
    const late = v.rows.find((x) => x.description === "Late night")!;
    expect(late.date).toBe("2026-08-31");
    expect(v.rows.find((x) => x.description === "I paid for everyone")).toBeUndefined(); // no share of mine → not shown
    expect(v.rows.find((x) => x.description.includes("paid Krish"))!.status).toBe("excluded");
    expect(await total()).toBe(1250 + 3000 + 500 + 87500 + 2500);
    const [o] = await db.select().from(schema.owners).where(eq(schema.owners.id, owner.id));
    expect(o!.splitwiseUserId).toBe(ME);
  });

  it("spec test 3: re-syncing the same data is idempotent", async () => {
    await syncMonth(db, owner, sw, "2026-08");
    const t1 = await total();
    const r2 = await syncMonth(db, owner, sw, "2026-08");
    expect(r2).toMatchObject({ inserted: 0, updated: 0, unchanged: 5 });
    expect(await db.select().from(schema.splitwiseExpenses)).toHaveLength(5);
    expect(await total()).toBe(t1);
    expect((await view()).rows.filter((x) => x.source === "recurring")).toHaveLength(2);
  });

  it("an edit in Splitwise updates the open month on the next sync", async () => {
    await syncMonth(db, owner, sw, "2026-08");
    sw.edit(1, { myOwed: "20.00" });
    const r = await syncMonth(db, owner, sw, "2026-08");
    expect(r).toMatchObject({ updated: 1, unchanged: 4 });
    expect(await total()).toBe(2000 + 3000 + 500 + 87500 + 2500);
  });

  it("an expense that disappears goes to Needs review, never silently dropped", async () => {
    await syncMonth(db, owner, sw, "2026-08");
    sw.expenses = sw.expenses.filter((e) => e.id !== 2);
    const r = await syncMonth(db, owner, sw, "2026-08");
    expect(r.missing).toBe(1);
    const row = (await view()).rows.find((x) => x.description === "Dinner")!;
    expect(row).toMatchObject({ status: "review", reason: "missing_in_splitwise", shareMinor: 0 });
    sw.expenses.push(makeExpense({ id: 2, description: "Dinner", category: { id: 2, name: "Dining out" }, myOwed: "30.00" }));
    await syncMonth(db, owner, sw, "2026-08");
    expect((await view()).rows.find((x) => x.description === "Dinner")!.status).toBe("included");
  });

  describe("spec test 2: Not-an-expense decisions", () => {
    beforeEach(() => {
      sw.expenses.push(
        makeExpense({ id: 10, description: "Varun Gas Refund", cost: "193.28", myOwed: "193.28", date: "2026-09-01T16:00:00Z" }),
        makeExpense({ id: 11, description: "Amazon refund", myOwed: "15.00", date: "2026-09-03T16:00:00Z" }),
        makeExpense({
          id: 12,
          description: "Varun - Gas Refund",
          cost: "157.98",
          myOwed: "157.98",
          group_id: null,
          date: "2026-09-01T17:00:00Z",
          users: [
            { user_id: ME, user: { first_name: "Krish", last_name: "Murjani" }, paid_share: "0.00", owed_share: "157.98", net_balance: "-157.98" },
            { user_id: FRIEND, user: { first_name: "Prathamesh", last_name: "A" }, paid_share: "157.98", owed_share: "0.00", net_balance: "157.98" },
          ],
        }),
      );
    });

    it("pre-seeded decisions pin on first sync and persist across re-syncs", async () => {
      const r1 = await syncMonth(db, owner, sw, "2026-09");
      expect(r1.pinned).toBe(2);
      for (let i = 0; i < 2; i++) {
        const v = await view("2026-09");
        const varun = v.rows.filter((x) => x.description.startsWith("Varun"));
        expect(varun.map((x) => [x.status, x.reason])).toEqual([
          ["excluded", "not_an_expense"],
          ["excluded", "not_an_expense"],
        ]);
        expect(varun.every((x) => x.reasonText.includes("balance adjustment"))).toBe(true);
        await syncMonth(db, owner, sw, "2026-09");
      }
      const pinned = await db.select().from(schema.expenseDecisions).where(eq(schema.expenseDecisions.state, "pinned"));
      expect(pinned.map((d) => d.rowKey).sort()).toEqual(["sw:10", "sw:12"]);
    });

    it("no keyword exclusion: another refund stays included", async () => {
      await syncMonth(db, owner, sw, "2026-09");
      expect((await view("2026-09")).rows.find((x) => x.description === "Amazon refund")!.status).toBe("included");
    });

    it("a manual decision persists across re-sync and can be undone", async () => {
      await syncMonth(db, owner, sw, "2026-09");
      const d = await markNotExpense(db, owner, { rowKey: "sw:11", reason: "Returned", idempotencyKey: "k1" });
      const again = await markNotExpense(db, owner, { rowKey: "sw:11", reason: "Returned", idempotencyKey: "k1" });
      expect(again.id).toBe(d.id); // idempotent retry
      await syncMonth(db, owner, sw, "2026-09");
      expect((await view("2026-09")).rows.find((x) => x.key === "sw:11")).toMatchObject({ status: "excluded", reasonText: "Returned" });
      await revokeDecision(db, owner, { id: d.id, expectedVersion: d.version });
      expect((await view("2026-09")).rows.find((x) => x.key === "sw:11")!.status).toBe("included");
      await expect(revokeDecision(db, owner, { id: d.id, expectedVersion: d.version })).rejects.toThrow(/changed elsewhere/);
    });
  });

  describe("dismissing the Large flag", () => {
    beforeEach(async () => {
      sw.expenses.push(makeExpense({ id: 20, description: "Con Edison", myOwed: "102.03", date: "2026-08-23T16:00:00Z" }));
      await syncMonth(db, owner, sw, "2026-08");
    });
    const flags = async () => (await view()).rows.find((x) => x.key === "sw:20")!;

    it("is per row, survives re-sync, can be restored, and never changes totals", async () => {
      const before = await total();
      expect((await flags()).flags).toContain("large");
      await setLargeDismissed(db, owner, { rowKey: "sw:20", dismissed: true });
      await setLargeDismissed(db, owner, { rowKey: "sw:20", dismissed: true }); // idempotent
      expect(await flags()).toMatchObject({ flags: expect.not.arrayContaining(["large"]), largeDismissed: true });
      await syncMonth(db, owner, sw, "2026-08");
      expect((await flags()).largeDismissed).toBe(true);
      expect((await view()).rows.find((x) => x.key === "sw:1")!.largeDismissed).toBe(false); // other rows untouched
      expect(await total()).toBe(before);
      await setLargeDismissed(db, owner, { rowKey: "sw:20", dismissed: false });
      expect((await flags()).flags).toContain("large");
    });
  });

  describe("spec test 4: closed month + changed Splitwise expense", () => {
    beforeEach(async () => {
      await syncMonth(db, owner, sw, "2026-08");
    });
    const rec = async () => (await db.select().from(schema.months).where(eq(schema.months.month, "2026-08")))[0]!;

    it("is flagged, not silently changed; accept recomputes", async () => {
      const snap = await closeMonth(db, owner, { month: "2026-08", expectedVersion: (await rec()).version });
      const closedTotal = snap.totalMinor;
      sw.edit(1, { myOwed: "99.00" });
      sw.expenses.push(makeExpense({ id: 6, description: "Added after close", myOwed: "7.00" }));
      const r = await syncMonth(db, owner, sw, "2026-08");
      expect(r.closedMonthsChanged).toEqual(["2026-08"]);
      const v = await view();
      expect(v.status).toBe("closed");
      expect(v.summary!.totalMinor).toBe(closedTotal); // unchanged
      expect(v.rows.find((x) => x.key === "sw:1")!.shareMinor).toBe(1250);
      expect(v.pendingChanges!.added.map((a) => a.key)).toEqual(["sw:6"]);
      expect(v.pendingChanges!.changed.map((c) => c.key)).toEqual(["sw:1"]);

      await acceptChanges(db, owner, { month: "2026-08", expectedVersion: (await rec()).version });
      const after = await view();
      expect(after.pendingChanges).toBeNull();
      expect(after.summary!.totalMinor).toBe(closedTotal - 1250 + 9900 + 700);
    });

    it("keep snapshot dismisses this diff; a later different change is flagged again", async () => {
      await closeMonth(db, owner, { month: "2026-08", expectedVersion: (await rec()).version });
      sw.edit(1, { myOwed: "99.00" });
      await syncMonth(db, owner, sw, "2026-08");
      await keepSnapshot(db, owner, { month: "2026-08", expectedVersion: (await rec()).version });
      await syncMonth(db, owner, sw, "2026-08");
      expect((await rec()).pendingChanges).toBeNull();
      sw.edit(2, { myOwed: "1.00" });
      await syncMonth(db, owner, sw, "2026-08");
      expect((await rec()).pendingChanges).not.toBeNull();
    });

    it("change detection via updated_after also flags the closed month", async () => {
      await closeMonth(db, owner, { month: "2026-08", expectedVersion: (await rec()).version });
      sw.edit(2, { deleted_at: new Date().toISOString() });
      const r = await syncChanges(db, owner, sw);
      expect(r!.fetched).toBe(1);
      expect(r!.closedMonthsChanged).toEqual(["2026-08"]);
      const diff = (await view()).pendingChanges!;
      expect(diff.changed[0]!.after).toMatchObject({ status: "excluded", reasonText: "Deleted in Splitwise" });
    });

    it("closing is blocked while something needs review", async () => {
      sw.expenses.push(makeExpense({ id: 7, description: "Euro dinner", currency_code: "EUR", myOwed: "9.00" }));
      await syncMonth(db, owner, sw, "2026-08");
      await expect(closeMonth(db, owner, { month: "2026-08", expectedVersion: (await rec()).version })).rejects.toBeInstanceOf(ClosingBlockedError);
    });

    it("closing freezes the budget so a later default change can't rewrite it", async () => {
      await closeMonth(db, owner, { month: "2026-08", expectedVersion: (await rec()).version });
      await db.update(schema.budgetDefaults).set({ amountMinor: 1 });
      const v = await view();
      expect(v.summary!.budgetTotalMinor).toBe(136800);
    });
  });
});
