// Income (spec test 10 via the DB), budgets, history summaries and the insights series.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { ScriptDb } from "@/server/db/connect";
import { loadMonthView, monthlySeries } from "@/server/month-data";
import { resolveOwner, type Owner } from "@/server/owner-core";
import { budgetForMonth, createCategory, saveDefaultBudget, saveMonthBudget } from "@/server/repos/budgets";
import { ConflictError, UserFacingError } from "@/server/repos/errors";
import { addManualExpense } from "@/server/repos/expenses";
import { commitHistory, previewHistory } from "@/server/repos/history";
import { addIncome, deleteIncome, listIncome, updateIncome } from "@/server/repos/income";
import { closeMonth } from "@/server/repos/months";
import { seed } from "@/server/seed";
import { dbAvailable, ENV, openTestDb, OWNER_EMAIL, resetDb } from "./db";

const up = await dbAvailable();
const NOW = new Date("2026-11-15T12:00:00Z");

describe.skipIf(!up)("phase 5 data (DB)", () => {
  let db: ScriptDb;
  let close: () => Promise<void>;
  let owner: Owner;
  let cat: (name: string) => string;
  beforeAll(async () => {
    ({ db, close } = await openTestDb());
  });
  afterAll(async () => close?.());
  beforeEach(async () => {
    await resetDb(db);
    await seed(db, { ownerEmail: OWNER_EMAIL });
    owner = await resolveOwner({ user: { email: OWNER_EMAIL } }, db, ENV);
    const cats = await db.select().from(schema.categories);
    cat = (name) => cats.find((c) => c.name === name)!.id;
  });

  const pay = (date: string, amount: number, key: string) => addIncome(db, owner, { date, amountMinor: amount, employer: "Acme", note: null, idempotencyKey: key });
  const spend = (date: string, amount: number, key: string, category = "Groceries") =>
    addManualExpense(db, owner, { date, description: "x", categoryId: cat(category), amountMinor: amount, note: null, idempotencyKey: key });

  describe("income (spec test 10)", () => {
    it("3-paycheck and 2-paycheck months; missing is Not recorded, not $0", async () => {
      for (const [i, d] of ["2026-01-02", "2026-01-16", "2026-01-30", "2026-02-13", "2026-02-27"].entries()) await pay(d, 250000, `p${i}`);
      expect((await loadMonthView(db, owner, "2026-01", NOW)).income.totalMinor).toBe(750000);
      expect((await loadMonthView(db, owner, "2026-02", NOW)).income.entries).toHaveLength(2);
      expect((await loadMonthView(db, owner, "2026-03", NOW)).income.totalMinor).toBeNull();
    });

    it("left over = income − expenses; null when income isn't recorded", async () => {
      await spend("2026-08-05", 10000, "s1");
      expect((await loadMonthView(db, owner, "2026-08", NOW)).summary!.leftOverMinor).toBeNull();
      await pay("2026-08-07", 300000, "p1");
      const v = await loadMonthView(db, owner, "2026-08", NOW);
      expect(v.summary!.leftOverMinor).toBe(300000 - (10000 + 87500 + 2500));
    });

    it("idempotent add, versioned edit, soft delete", async () => {
      const a = await pay("2026-08-07", 100, "same-key");
      const b = await pay("2026-08-07", 100, "same-key");
      expect(b.id).toBe(a.id);
      const u = await updateIncome(db, owner, { id: a.id, expectedVersion: 1, date: "2026-08-08", amountMinor: 200, employer: "Acme", note: null });
      await expect(updateIncome(db, owner, { id: a.id, expectedVersion: 1, date: "2026-08-08", amountMinor: 300, employer: null, note: null })).rejects.toBeInstanceOf(ConflictError);
      await deleteIncome(db, owner, { id: a.id, expectedVersion: u.version });
      expect(await listIncome(db, owner)).toEqual([]);
    });
  });

  describe("budgets", () => {
    it("default budget applies until a month gets its own", async () => {
      const b = await budgetForMonth(db, owner, "2026-08");
      expect(b.source).toBe("default");
      expect(Object.values(b.amounts).reduce((x, y) => x + y, 0)).toBe(136800);
    });

    it("saving for one month affects only that month", async () => {
      const exp = (await budgetForMonth(db, owner, "2026-08")).amounts;
      await saveMonthBudget(db, owner, { month: "2026-08", amounts: [{ categoryId: cat("Groceries"), amountMinor: 15000 }], expected: exp });
      expect((await budgetForMonth(db, owner, "2026-08")).amounts[cat("Groceries")]).toBe(15000);
      expect((await budgetForMonth(db, owner, "2026-09")).amounts[cat("Groceries")]).toBe(10000);
    });

    it("a new default never rewrites past months (closed or with their own budget)", async () => {
      await spend("2026-07-05", 1000, "s-jul");
      await closeMonth(db, owner, { month: "2026-07", expectedVersion: null });
      const exp = (await budgetForMonth(db, owner, "2026-09")).amounts;
      await saveDefaultBudget(db, owner, { fromMonth: "2026-09", amounts: [{ categoryId: cat("Dining Out"), amountMinor: 20000 }], expected: exp });
      expect((await budgetForMonth(db, owner, "2026-07")).amounts[cat("Dining Out")]).toBe(10000);
      expect((await budgetForMonth(db, owner, "2026-08")).amounts[cat("Dining Out")]).toBe(10000);
      expect((await budgetForMonth(db, owner, "2026-09")).amounts[cat("Dining Out")]).toBe(20000);
      expect((await budgetForMonth(db, owner, "2027-03")).amounts[cat("Dining Out")]).toBe(20000);
    });

    it("stale budget edits conflict; closed months can't be edited", async () => {
      const exp = (await budgetForMonth(db, owner, "2026-08")).amounts;
      await saveMonthBudget(db, owner, { month: "2026-08", amounts: [{ categoryId: cat("Rent"), amountMinor: 90000 }], expected: exp });
      await expect(saveMonthBudget(db, owner, { month: "2026-08", amounts: [{ categoryId: cat("Rent"), amountMinor: 1 }], expected: exp })).rejects.toBeInstanceOf(ConflictError);
      await spend("2026-06-05", 1000, "s-jun");
      await closeMonth(db, owner, { month: "2026-06", expectedVersion: null });
      const jun = (await budgetForMonth(db, owner, "2026-06")).amounts;
      await expect(saveMonthBudget(db, owner, { month: "2026-06", amounts: [{ categoryId: cat("Rent"), amountMinor: 1 }], expected: jun })).rejects.toBeInstanceOf(UserFacingError);
    });

    it("custom categories (e.g. Trip - Miami) can be created once", async () => {
      await createCategory(db, owner, { name: "Trip - Miami" });
      await expect(createCategory(db, owner, { name: "trip - miami" })).rejects.toBeInstanceOf(UserFacingError);
    });
  });

  describe("history summaries", () => {
    const csv = "month,category,amount\n2025-05,Rent,875\n2025-05,Groceries,579.93\n2025-06,Rent,875\n2025-06,Groceries,456.78\n2026-08,Rent,1";

    it("preview validates against known totals and writes nothing", async () => {
      await spend("2026-08-05", 1000, "s1");
      const p = await previewHistory(db, owner, csv);
      expect(p.months.map((m) => [m.month, m.matches, m.hasDetail])).toEqual([
        ["2025-05", true, false],
        ["2025-06", false, false],
        ["2026-08", null, true],
      ]);
      expect(await db.select().from(schema.historySummaries)).toHaveLength(0);
    });

    it("a summary month shows totals by category, never $0 for missing months", async () => {
      await commitHistory(db, owner, csv);
      const may = await loadMonthView(db, owner, "2025-05", NOW);
      expect(may).toMatchObject({ kind: "summary", rows: [] });
      expect(may.summary!.totalMinor).toBe(145493);
      expect((await loadMonthView(db, owner, "2025-04", NOW)).kind).toBe("none");
    });

    it("re-importing a month replaces its summary (never adds)", async () => {
      await commitHistory(db, owner, csv);
      await commitHistory(db, owner, "month,category,amount\n2025-05,Rent,1000");
      expect((await loadMonthView(db, owner, "2025-05", NOW)).summary!.totalMinor).toBe(100000);
      expect((await loadMonthView(db, owner, "2025-06", NOW)).summary!.totalMinor).toBe(133178);
    });

    it("detailed data wins over a summary for the same month", async () => {
      await commitHistory(db, owner, csv);
      await spend("2026-08-05", 1000, "s1");
      const aug = await loadMonthView(db, owner, "2026-08", NOW);
      expect(aug.kind).toBe("detailed");
      expect(aug.summary!.totalMinor).toBe(1000 + 87500 + 2500);
    });

    it("files with errors are refused whole", async () => {
      await expect(commitHistory(db, owner, "month,category,amount\n2025-05,Nope,1\n2025-06,Rent,1")).rejects.toBeInstanceOf(UserFacingError);
      expect(await db.select().from(schema.historySummaries)).toHaveLength(0);
    });
  });

  describe("insights series", () => {
    it("includes only months with data, marks summaries and the current month as partial", async () => {
      await commitHistory(db, owner, "month,category,amount\n2026-07,Rent,1704.81");
      await spend("2026-08-05", 1000, "s1");
      await pay("2026-10-09", 250000, "p1");
      await spend("2026-11-03", 500, "s2");
      const s = await monthlySeries(db, owner, NOW);
      expect(s.map((p) => [p.month, p.kind, p.hasSpending, p.partial])).toEqual([
        ["2026-07", "summary", true, false],
        ["2026-08", "detailed", true, false],
        ["2026-10", "detailed", false, false],
        ["2026-11", "detailed", true, true],
      ]);
      expect(s.find((p) => p.month === "2026-08")!.totalMinor).toBe(91000);
      expect(s.find((p) => p.month === "2026-10")!.incomeMinor).toBe(250000);
    });

    it("previous-month change uses the summary when last month has no detail", async () => {
      await commitHistory(db, owner, "month,category,amount\n2026-07,Rent,1704.81");
      await spend("2026-08-05", 1000, "s1");
      const v = await loadMonthView(db, owner, "2026-08", NOW);
      expect(v.summary!.previousTotalMinor).toBe(170481);
      expect(v.summary!.changeVsPreviousMinor).toBe(91000 - 170481);
    });
  });
});
