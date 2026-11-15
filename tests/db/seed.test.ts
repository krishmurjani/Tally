import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sisterFundedMinor, type LenderPayment } from "@/engines/loan/ledger";
import { sisterLedger } from "@/engines/loan/sister";
import { RUPEE } from "@/engines/loan/seed";
import * as schema from "@/server/db/schema";
import type { ScriptDb } from "@/server/db/connect";
import { seed } from "@/server/seed";
import { dbAvailable, openTestDb, OWNER_EMAIL, resetDb } from "./db";

const up = await dbAvailable();

describe.skipIf(!up)("seed script", () => {
  let db: ScriptDb;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ db, close } = await openTestDb());
    await resetDb(db);
  });
  afterAll(async () => close?.());

  it("inserts everything on the first run", async () => {
    const r = await seed(db, { ownerEmail: OWNER_EMAIL });
    for (const [table, { inserted, total }] of Object.entries(r)) expect([table, inserted]).toEqual([table, total]);
  });

  it("is idempotent: a second run inserts nothing", async () => {
    const r = await seed(db, { ownerEmail: OWNER_EMAIL.toUpperCase() });
    for (const [table, { inserted }] of Object.entries(r)) expect([table, inserted]).toEqual([table, 0]);
    expect(await db.select().from(schema.owners)).toHaveLength(1);
  });

  it("never overwrites edits made after seeding", async () => {
    await db.update(schema.budgetDefaults).set({ amountMinor: 12345 });
    await seed(db, { ownerEmail: OWNER_EMAIL });
    const rows = await db.select().from(schema.budgetDefaults);
    expect(rows.every((r) => r.amountMinor === 12345)).toBe(true);
  });

  it("seeds the budget total of $1,368 across 12 built-in categories (+ Travel custom)", async () => {
    await resetDb(db);
    await seed(db, { ownerEmail: OWNER_EMAIL });
    const cats = await db.select().from(schema.categories);
    expect(cats.filter((c) => c.kind === "builtin")).toHaveLength(12);
    expect(cats.map((c) => c.name)).toContain("Travel");
    const budgets = await db.select().from(schema.budgetDefaults);
    expect(budgets.reduce((s, b) => s + b.amountMinor, 0)).toBe(136800);
  });

  it("loan ledger from the DB: sister paid ₹2,13,935, owed ₹1,24,433, bounce excluded", async () => {
    const pays = await db.select().from(schema.lenderPayments);
    const asEngine: LenderPayment[] = pays.map((p) => ({ ...p, id: p.idempotencyKey }));
    expect(sisterFundedMinor(asEngine)).toBe(2_13_935 * RUPEE);
    const reimb = await db.select().from(schema.sisterReimbursements);
    const l = sisterLedger(asEngine, reimb.map((r) => ({ ...r, id: r.idempotencyKey })));
    expect(l.owedMinor).toBe(1_24_433 * RUPEE);
    expect(pays.filter((p) => p.type === "bounce")).toHaveLength(1);
    expect(pays.filter((p) => p.status === "planned")).toHaveLength(9);
  });

  it("pre-seeded decisions start pending (pinned on first sync) and local ones are kept separate", async () => {
    await seed(db, {
      ownerEmail: OWNER_EMAIL,
      localDecisions: [{ id: "local-x", date: "2026-03-01", description: "x", costMinor: 1, group: null, reason: "r" }],
    });
    const d = await db.select().from(schema.expenseDecisions);
    expect(d.filter((x) => x.origin === "preseed")).toHaveLength(3);
    expect(d.filter((x) => x.origin === "local")).toHaveLength(1);
    expect(d.every((x) => x.state === "pending" && x.rowKey === null)).toBe(true);
  });

  it("schedule is labelled imported, unverified", async () => {
    const [s] = await db.select().from(schema.loanSchedules);
    expect(s!.provenance).toBe("imported, unverified");
    expect(s!.openingBalanceMinor).toBe(88_26_923 * RUPEE);
  });

  it("DB constraints reject a paid payment without a paid date", async () => {
    const [loan] = await db.select().from(schema.loans);
    const [owner] = await db.select().from(schema.owners).where(eq(schema.owners.email, OWNER_EMAIL));
    await expect(
      db.insert(schema.lenderPayments).values({
        ownerId: owner!.id,
        loanId: loan!.id,
        dueDate: "2027-01-11",
        paidDate: null,
        amountMinor: 100,
        payer: "krish",
        type: "pmii_emi",
        status: "paid",
        idempotencyKey: "bad",
      }),
    ).rejects.toThrow();
  });
});
