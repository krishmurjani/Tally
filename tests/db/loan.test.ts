// Loan ledgers through the DB (spec test 11 end-to-end) and planner scenario persistence.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { paidTotals, sisterFundedMinor } from "@/engines/loan/ledger";
import { defaultScenario } from "@/engines/loan/scenario";
import { RUPEE } from "@/engines/loan/seed";
import { sisterLedger } from "@/engines/loan/sister";
import type { ScriptDb } from "@/server/db/connect";
import { resolveOwner, type Owner } from "@/server/owner-core";
import { ConflictError, UserFacingError } from "@/server/repos/errors";
import {
  addPayment,
  addRateChange,
  addReimbursement,
  deletePayment,
  deleteReimbursement,
  loadLoanFacts,
  loadLoanLedgers,
  loadScenario,
  markPaymentPaid,
  saveScenario,
  updatePayment,
  type PaymentInput,
} from "@/server/repos/loan";
import { seed } from "@/server/seed";
import { dbAvailable, ENV, openTestDb, OWNER_EMAIL, resetDb } from "./db";

const up = await dbAvailable();
const inr = (r: number) => r * RUPEE;

describe.skipIf(!up)("loan ledgers (DB)", () => {
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
  const ledgers = () => loadLoanLedgers(db, owner);
  const base: PaymentInput = { dueDate: "2026-12-11", paidDate: null, amountMinor: inr(9_846), payer: "krish", type: "pmii_emi", status: "planned", reference: null, note: null, interestMinor: null, principalMinor: null };

  it("spec test 11 from the DB: sister ₹2,13,935, owed ₹1,24,433, bounce excluded", async () => {
    const { payments, reimbursements } = await ledgers();
    expect(sisterFundedMinor(payments)).toBe(inr(2_13_935));
    expect(sisterLedger(payments, reimbursements).owedMinor).toBe(inr(1_24_433));
    expect(paidTotals(payments).bouncedCount).toBe(1);
  });

  it("reimbursing her changes what I owe her but never the lender totals", async () => {
    const before = paidTotals((await ledgers()).payments);
    const r = await addReimbursement(db, owner, { date: "2026-11-15", amountMinor: inr(24_433), note: "Nov transfer", idempotencyKey: "reimb-001" });
    await addReimbursement(db, owner, { date: "2026-11-15", amountMinor: inr(24_433), note: "Nov transfer", idempotencyKey: "reimb-001" }); // retry
    const after = await ledgers();
    expect(paidTotals(after.payments)).toEqual(before);
    expect(sisterLedger(after.payments, after.reimbursements).owedMinor).toBe(inr(1_00_000));
    await deleteReimbursement(db, owner, { id: r.id, expectedVersion: r.version });
    const again = await ledgers();
    expect(sisterLedger(again.payments, again.reimbursements).owedMinor).toBe(inr(1_24_433));
  });

  it("planned payments only count once marked paid", async () => {
    const planned = (await ledgers()).payments.find((p) => p.dueDate === "2026-12-11" && p.status === "planned")!;
    const before = paidTotals((await ledgers()).payments).byPayer.krish;
    await markPaymentPaid(db, owner, { id: planned.id, expectedVersion: planned.version, paidDate: "2026-12-10", payer: "krish" });
    expect(paidTotals((await ledgers()).payments).byPayer.krish).toBe(before + inr(9_846));
    await expect(markPaymentPaid(db, owner, { id: planned.id, expectedVersion: planned.version, paidDate: "2026-12-10", payer: "krish" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("payment rules: paid needs a date, bounce ⇔ bounced, allocation must add up", async () => {
    await expect(addPayment(db, owner, { ...base, status: "paid", idempotencyKey: "p-1" })).rejects.toBeInstanceOf(UserFacingError);
    await expect(addPayment(db, owner, { ...base, type: "bounce", idempotencyKey: "p-2" })).rejects.toBeInstanceOf(UserFacingError);
    await expect(addPayment(db, owner, { ...base, interestMinor: inr(9_000), principalMinor: inr(800), idempotencyKey: "p-3" })).rejects.toBeInstanceOf(UserFacingError);
    const ok = await addPayment(db, owner, { ...base, status: "paid", paidDate: "2026-12-11", interestMinor: inr(9_000), principalMinor: inr(846), idempotencyKey: "p-4" });
    const again = await addPayment(db, owner, { ...base, status: "paid", paidDate: "2026-12-11", interestMinor: inr(9_000), principalMinor: inr(846), idempotencyKey: "p-4" });
    expect(again.id).toBe(ok.id);
    const upd = await updatePayment(db, owner, { ...base, id: ok.id, expectedVersion: ok.version, status: "paid", paidDate: "2026-12-12", payer: "other" });
    await expect(updatePayment(db, owner, { ...base, id: ok.id, expectedVersion: ok.version })).rejects.toBeInstanceOf(ConflictError);
    await deletePayment(db, owner, { id: ok.id, expectedVersion: upd.version });
    expect((await ledgers()).payments.find((p) => p.id === ok.id)).toBeUndefined();
  });

  it("rate changes are kept with effective dates", async () => {
    await addRateChange(db, owner, { effectiveFrom: "2027-01-01", annualPercent: "11.25", note: "Floating reset" });
    await expect(addRateChange(db, owner, { effectiveFrom: "2027-01-01", annualPercent: "11", note: null })).rejects.toBeInstanceOf(UserFacingError);
    const { rates } = await loadLoanFacts(db, owner);
    expect(rates.map((r) => [r.effectiveFrom, r.annualPercent])).toEqual([
      ["2024-08-11", "11.5"],
      ["2024-11-11", "11.7"],
      ["2025-08-11", "11.5"],
      ["2026-02-11", "11.4"],
      ["2026-07-11", "11.55"],
      ["2026-10-11", "11.8"],
      ["2027-01-01", "11.25"],
    ]);
  });

  it("planner scenario: first save, versioned updates, stale save conflicts", async () => {
    expect(await loadScenario(db, owner)).toBeNull();
    const s = defaultScenario("2026-11-15", "11.55");
    const a = await saveScenario(db, owner, { inputs: s, expectedVersion: null });
    const b = await saveScenario(db, owner, { inputs: { ...s, monthlyExtraUsdMinor: 50_000 }, expectedVersion: a.version });
    await expect(saveScenario(db, owner, { inputs: s, expectedVersion: a.version })).rejects.toBeInstanceOf(ConflictError);
    await expect(saveScenario(db, owner, { inputs: s, expectedVersion: null })).rejects.toBeInstanceOf(ConflictError);
    const loaded = await loadScenario(db, owner);
    expect(loaded).toMatchObject({ version: b.version, inputs: { monthlyExtraUsdMinor: 50_000 } });
  });
});
