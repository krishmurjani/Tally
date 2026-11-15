import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { ScriptDb } from "@/server/db/connect";
import { loadMonthView } from "@/server/month-data";
import { resolveOwner, type Owner } from "@/server/owner-core";
import { markNotExpense, markNotExpenseBulk } from "@/server/repos/decisions";
import { setCategoryOverridesBulk } from "@/server/repos/expenses";
import { seed } from "@/server/seed";
import { syncMonth } from "@/server/splitwise/sync";
import { FakeSplitwise, makeExpense } from "../server/fake-splitwise";
import { dbAvailable, ENV, openTestDb, OWNER_EMAIL, resetDb } from "./db";

const up = await dbAvailable();

describe.skipIf(!up)("bulk actions (DB)", () => {
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
    const sw = new FakeSplitwise();
    sw.expenses = [1, 2, 3].map((i) => makeExpense({ id: i, description: `item ${i}`, category: { id: 9, name: "Car" }, myOwed: "10.00" }));
    await syncMonth(db, owner, sw, "2026-08");
  });
  const view = () => loadMonthView(db, owner, "2026-08");

  it("tags many rows with one category in one go", async () => {
    expect((await view()).rows.filter((r) => r.flags.includes("needs_category"))).toHaveLength(3);
    const transport = (await db.select().from(schema.categories)).find((c) => c.name === "Transport")!;
    expect(await setCategoryOverridesBulk(db, owner, { rowKeys: ["sw:1", "sw:2", "sw:3", "sw:1"], categoryId: transport.id })).toEqual({ updated: 3 });
    const v = await view();
    expect(v.rows.filter((r) => r.key.startsWith("sw:")).every((r) => r.category === "Transport" && r.hasOverride)).toBe(true);
    expect(v.summary!.counts.needsCategory).toBe(0);
    expect(v.summary!.byCategory.find((c) => c.category === "Transport")!.actualMinor).toBe(3000);
  });

  it("marks many rows as not an expense, skipping ones already decided, and retries are harmless", async () => {
    await markNotExpense(db, owner, { rowKey: "sw:2", reason: "earlier", idempotencyKey: "single-1" });
    const r = await markNotExpenseBulk(db, owner, { rowKeys: ["sw:1", "sw:2", "sw:3"], reason: "Balance transfer", idempotencyKey: "bulk-1111" });
    expect(r).toEqual({ marked: 2, skipped: 1 });
    expect(await markNotExpenseBulk(db, owner, { rowKeys: ["sw:1", "sw:3"], reason: "Balance transfer", idempotencyKey: "bulk-1111" })).toEqual({ marked: 0, skipped: 2 });
    const v = await view();
    expect(v.rows.filter((x) => x.key.startsWith("sw:")).every((x) => x.reason === "not_an_expense")).toBe(true);
    expect(v.rows.find((x) => x.key === "sw:2")!.reasonText).toBe("earlier"); // the earlier decision is untouched
    expect(v.rows.find((x) => x.key === "sw:1")!.reasonText).toBe("Balance transfer");
  });
});
