// Server actions end-to-end (session lookup stubbed): owner check first, validation, typed results.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/server/db/schema";
import type { ScriptDb } from "@/server/db/connect";
import { UnauthorizedError, type Owner } from "@/server/owner-core";
import { dbAvailable, openTestDb, OWNER_EMAIL, resetDb } from "./db";

const state: { db: ScriptDb | null; owner: Owner | null } = { db: null, owner: null };
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/server/auth-guard", () => ({
  requireOwner: async () => {
    if (!state.owner) throw new UnauthorizedError();
    return state.owner;
  },
}));

const up = await dbAvailable();
const actions = await import("@/server/actions/expenses");
const settingsActions = await import("@/server/actions/settings");
const { seed } = await import("@/server/seed");
const { resolveOwner } = await import("@/server/owner-core");

describe.skipIf(!up)("server actions", () => {
  let close: () => Promise<void>;
  let owner: Owner;
  let categoryId: string;
  beforeAll(async () => {
    const t = await openTestDb();
    state.db = t.db;
    close = t.close;
  });
  afterAll(async () => close?.());
  beforeEach(async () => {
    await resetDb(state.db!);
    await seed(state.db!, { ownerEmail: OWNER_EMAIL });
    owner = await resolveOwner({ user: { email: OWNER_EMAIL } }, state.db!, { OWNER_EMAIL });
    categoryId = (await state.db!.select().from(schema.categories)).find((c) => c.name === "Groceries")!.id;
    state.owner = owner;
  });

  const add = (over: Record<string, unknown> = {}) =>
    actions.addManualExpenseAction({ month: "2026-08", date: "2026-08-10", description: "Farmers market", categoryId, amount: "12.34", note: null, idempotencyKey: "idem-0001", ...over });

  it("spec test 13: with no owner session, every action refuses and nothing is written", async () => {
    state.owner = null;
    const results = await Promise.all([
      add(),
      actions.markNotExpenseAction({ rowKey: "sw:1", reason: null, idempotencyKey: "idem-0002" }),
      actions.setCategoryAction({ rowKey: "sw:1", categoryId }),
      actions.closeMonthAction({ month: "2026-08", expectedVersion: null }),
      actions.setMonthSourceAction({ month: "2026-08", source: "csv" }),
      actions.syncMonthAction({ month: "2026-08" }),
      settingsActions.saveLargeThreshold({ thresholdMinor: 1, expectedVersion: 1 }),
    ]);
    expect(results.map((r) => (r.ok ? "ok" : r.error))).toEqual(Array(7).fill("unauthorized"));
    expect(await state.db!.select().from(schema.manualExpenses)).toHaveLength(0);
    expect(await state.db!.select().from(schema.expenseDecisions).then((d) => d.filter((x) => x.origin === "manual"))).toHaveLength(0);
    expect(await state.db!.select().from(schema.months)).toHaveLength(0);
  });

  it("validates input before doing any work", async () => {
    const r = await add({ amount: "12.345" });
    expect(r).toMatchObject({ ok: false, error: "invalid" });
    const wrongMonth = await add({ date: "2026-09-01" });
    expect(wrongMonth).toMatchObject({ ok: false, error: "invalid", message: "The date must be within 2026-08." });
  });

  it("manual creates are idempotent: a retried submit doesn't duplicate", async () => {
    const a = await add();
    const b = await add();
    expect(a.ok && b.ok && a.data.id === b.data.id).toBe(true);
    expect(await state.db!.select().from(schema.manualExpenses)).toHaveLength(1);
  });

  it("refunds (negative amounts) are allowed deliberately", async () => {
    const r = await add({ amount: "-5.00", idempotencyKey: "idem-refund" });
    expect(r.ok).toBe(true);
    const [row] = await state.db!.select().from(schema.manualExpenses);
    expect(row!.amountMinor).toBe(-500);
  });

  it("stale edits get a conflict result", async () => {
    const a = await add();
    const id = a.ok ? a.data.id : "";
    const upd = { month: "2026-08", date: "2026-08-11", description: "Edited", categoryId, amount: "1.00", note: null, id };
    expect((await actions.updateManualExpenseAction({ ...upd, expectedVersion: 1 })).ok).toBe(true);
    expect(await actions.updateManualExpenseAction({ ...upd, expectedVersion: 1 })).toMatchObject({ ok: false, error: "conflict" });
  });

  it("sync without a Splitwise key explains itself instead of failing silently", async () => {
    const prev = process.env.SPLITWISE_API_KEY;
    delete process.env.SPLITWISE_API_KEY;
    const r = await actions.syncMonthAction({ month: "2026-08" });
    expect(r).toMatchObject({ ok: false, error: "invalid" });
    expect(r.ok ? "" : r.message).toMatch(/SPLITWISE_API_KEY/);
    if (prev !== undefined) process.env.SPLITWISE_API_KEY = prev;
  });

  it("closing an empty month is refused; a manual-only month can close", async () => {
    expect((await actions.closeMonthAction({ month: "2026-07", expectedVersion: null })).ok).toBe(false);
    await add();
    const r = await actions.closeMonthAction({ month: "2026-08", expectedVersion: null });
    expect(r).toMatchObject({ ok: true, data: { totalMinor: 1234 + 87500 + 2500 } });
  });
});
