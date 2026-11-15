import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { LenderPayment } from "@/engines/loan/ledger";
import { ScenarioSchema, type Scenario } from "@/engines/loan/scenario";
import type { Reimbursement } from "@/engines/loan/sister";
import * as schema from "../db/schema";
import type { Owner } from "../owner-core";
import { ConflictError, NotFoundError, UserFacingError } from "./errors";

type AnyDb = NodePgDatabase<typeof schema>;

export type PaymentRecord = LenderPayment & { version: number; interestMinor: number | null; principalMinor: number | null };
export type ReimbursementRecord = Reimbursement & { version: number };

async function audit(db: AnyDb, owner: Owner, entity: string, id: string, action: string, before: unknown, after: unknown) {
  await db.insert(schema.auditLog).values({ ownerId: owner.id, entity, entityId: id, action, before, after });
}

export async function getLoan(db: AnyDb, owner: Owner) {
  const [loan] = await db.select().from(schema.loans).where(eq(schema.loans.ownerId, owner.id)).orderBy(asc(schema.loans.createdAt)).limit(1);
  if (!loan) throw new NotFoundError("loan", "—");
  return loan;
}

export async function loadLoanLedgers(db: AnyDb, owner: Owner): Promise<{ payments: PaymentRecord[]; reimbursements: ReimbursementRecord[] }> {
  const pays = await db
    .select()
    .from(schema.lenderPayments)
    .where(and(eq(schema.lenderPayments.ownerId, owner.id), isNull(schema.lenderPayments.deletedAt)))
    .orderBy(asc(schema.lenderPayments.dueDate), asc(schema.lenderPayments.createdAt));
  const reimb = await db
    .select()
    .from(schema.sisterReimbursements)
    .where(and(eq(schema.sisterReimbursements.ownerId, owner.id), isNull(schema.sisterReimbursements.deletedAt)))
    .orderBy(asc(schema.sisterReimbursements.date));
  return {
    payments: pays.map((p) => ({
      id: p.id,
      dueDate: p.dueDate,
      paidDate: p.paidDate,
      amountMinor: p.amountMinor,
      payer: p.payer,
      type: p.type,
      status: p.status,
      reference: p.reference,
      note: p.note,
      interestMinor: p.interestMinor,
      principalMinor: p.principalMinor,
      version: p.version,
    })),
    reimbursements: reimb.map((r) => ({ id: r.id, date: r.date, amountMinor: r.amountMinor, kind: r.kind, note: r.note, version: r.version })),
  };
}

/** Facts for the overview and planner: loan, rates, disbursements, latest schedule. */
export async function loadLoanFacts(db: AnyDb, owner: Owner) {
  const loan = await getLoan(db, owner);
  const [rates, disbursements, schedules] = await Promise.all([
    db.select().from(schema.loanRates).where(eq(schema.loanRates.loanId, loan.id)).orderBy(asc(schema.loanRates.effectiveFrom)),
    db.select().from(schema.loanDisbursements).where(eq(schema.loanDisbursements.loanId, loan.id)).orderBy(asc(schema.loanDisbursements.date)),
    db.select().from(schema.loanSchedules).where(eq(schema.loanSchedules.loanId, loan.id)).orderBy(desc(schema.loanSchedules.issuedOn)),
  ]);
  const schedule = schedules[0];
  if (!schedule) throw new NotFoundError("repayment schedule", loan.id);
  return { loan, rates, disbursements, schedule };
}

export interface PaymentInput {
  dueDate: string;
  paidDate: string | null;
  amountMinor: number;
  payer: "krish" | "sister" | "other" | null;
  type: "pmii_emi" | "repayment" | "bounce";
  status: "paid" | "planned" | "overdue" | "bounced";
  reference: string | null;
  note: string | null;
  interestMinor: number | null;
  principalMinor: number | null;
}

/** Business rules the DB also enforces, checked first so the message is useful. */
function checkPayment(p: PaymentInput) {
  if ((p.type === "bounce") !== (p.status === "bounced")) throw new UserFacingError("A bounce must have status “bounced” (and only a bounce can).");
  if (p.status === "paid" && !p.paidDate) throw new UserFacingError("A paid payment needs the date it was paid.");
  if (p.status === "planned" && p.paidDate) throw new UserFacingError("A planned payment can't have a paid date — mark it paid instead.");
  if ((p.interestMinor === null) !== (p.principalMinor === null)) throw new UserFacingError("Enter both the interest and principal parts, or neither.");
  if (p.interestMinor !== null && p.interestMinor + p.principalMinor! !== p.amountMinor) throw new UserFacingError("Interest + principal must equal the payment amount.");
}

export async function addPayment(db: AnyDb, owner: Owner, input: PaymentInput & { idempotencyKey: string }) {
  checkPayment(input);
  return db.transaction(async (tx) => {
    const loan = await getLoan(tx, owner);
    const ins = await tx
      .insert(schema.lenderPayments)
      .values({ ownerId: owner.id, loanId: loan.id, ...input })
      .onConflictDoNothing({ target: [schema.lenderPayments.ownerId, schema.lenderPayments.idempotencyKey] })
      .returning();
    const row =
      ins[0] ??
      (await tx.select().from(schema.lenderPayments).where(and(eq(schema.lenderPayments.ownerId, owner.id), eq(schema.lenderPayments.idempotencyKey, input.idempotencyKey))))[0]!;
    if (ins.length) await audit(tx, owner, "lender_payment", row.id, "create", null, input);
    return { id: row.id, version: row.version };
  });
}

export async function updatePayment(db: AnyDb, owner: Owner, input: PaymentInput & { id: string; expectedVersion: number }) {
  const { id, expectedVersion, ...values } = input;
  checkPayment(values);
  return db.transaction(async (tx) => {
    const [prev] = await tx.select().from(schema.lenderPayments).where(and(eq(schema.lenderPayments.id, id), eq(schema.lenderPayments.ownerId, owner.id), isNull(schema.lenderPayments.deletedAt)));
    if (!prev) throw new NotFoundError("payment", id);
    const res = await tx
      .update(schema.lenderPayments)
      .set({ ...values, version: expectedVersion + 1, updatedAt: new Date() })
      .where(and(eq(schema.lenderPayments.id, id), eq(schema.lenderPayments.ownerId, owner.id), eq(schema.lenderPayments.version, expectedVersion)))
      .returning();
    if (!res.length) throw new ConflictError("payment", id);
    await audit(tx, owner, "lender_payment", id, "update", prev, values);
    return { id, version: res[0]!.version };
  });
}

/** Planned → paid on a given date. Planned items never count until this happens. */
export async function markPaymentPaid(db: AnyDb, owner: Owner, input: { id: string; expectedVersion: number; paidDate: string; payer: "krish" | "sister" | "other" }) {
  return db.transaction(async (tx) => {
    const res = await tx
      .update(schema.lenderPayments)
      .set({ status: "paid", paidDate: input.paidDate, payer: input.payer, version: input.expectedVersion + 1, updatedAt: new Date() })
      .where(
        and(
          eq(schema.lenderPayments.id, input.id),
          eq(schema.lenderPayments.ownerId, owner.id),
          eq(schema.lenderPayments.version, input.expectedVersion),
          eq(schema.lenderPayments.status, "planned"),
        ),
      )
      .returning();
    if (!res.length) throw new ConflictError("payment", input.id);
    await audit(tx, owner, "lender_payment", input.id, "mark_paid", { status: "planned" }, { status: "paid", paidDate: input.paidDate });
    return { id: input.id, version: res[0]!.version };
  });
}

export async function deletePayment(db: AnyDb, owner: Owner, input: { id: string; expectedVersion: number }) {
  await db.transaction(async (tx) => {
    const res = await tx
      .update(schema.lenderPayments)
      .set({ deletedAt: new Date(), version: input.expectedVersion + 1, updatedAt: new Date() })
      .where(and(eq(schema.lenderPayments.id, input.id), eq(schema.lenderPayments.ownerId, owner.id), eq(schema.lenderPayments.version, input.expectedVersion), isNull(schema.lenderPayments.deletedAt)))
      .returning({ id: schema.lenderPayments.id });
    if (!res.length) throw new ConflictError("payment", input.id);
    await audit(tx, owner, "lender_payment", input.id, "delete", null, null);
  });
}

export interface ReimbursementInput {
  date: string;
  amountMinor: number;
  note: string | null;
}

export async function addReimbursement(db: AnyDb, owner: Owner, input: ReimbursementInput & { idempotencyKey: string }) {
  if (input.amountMinor <= 0) throw new UserFacingError("A reimbursement must be more than ₹0.");
  return db.transaction(async (tx) => {
    const loan = await getLoan(tx, owner);
    const ins = await tx
      .insert(schema.sisterReimbursements)
      .values({ ownerId: owner.id, loanId: loan.id, kind: "entry", ...input })
      .onConflictDoNothing({ target: [schema.sisterReimbursements.ownerId, schema.sisterReimbursements.idempotencyKey] })
      .returning();
    const row =
      ins[0] ??
      (await tx.select().from(schema.sisterReimbursements).where(and(eq(schema.sisterReimbursements.ownerId, owner.id), eq(schema.sisterReimbursements.idempotencyKey, input.idempotencyKey))))[0]!;
    if (ins.length) await audit(tx, owner, "sister_reimbursement", row.id, "create", null, input);
    return { id: row.id, version: row.version };
  });
}

export async function updateReimbursement(db: AnyDb, owner: Owner, input: ReimbursementInput & { id: string; expectedVersion: number }) {
  if (input.amountMinor <= 0) throw new UserFacingError("A reimbursement must be more than ₹0.");
  const { id, expectedVersion, ...values } = input;
  return db.transaction(async (tx) => {
    const res = await tx
      .update(schema.sisterReimbursements)
      .set({ ...values, version: expectedVersion + 1, updatedAt: new Date() })
      .where(and(eq(schema.sisterReimbursements.id, id), eq(schema.sisterReimbursements.ownerId, owner.id), eq(schema.sisterReimbursements.version, expectedVersion), isNull(schema.sisterReimbursements.deletedAt)))
      .returning();
    if (!res.length) throw new ConflictError("reimbursement", id);
    await audit(tx, owner, "sister_reimbursement", id, "update", null, values);
    return { id, version: res[0]!.version };
  });
}

export async function deleteReimbursement(db: AnyDb, owner: Owner, input: { id: string; expectedVersion: number }) {
  await db.transaction(async (tx) => {
    const res = await tx
      .update(schema.sisterReimbursements)
      .set({ deletedAt: new Date(), version: input.expectedVersion + 1, updatedAt: new Date() })
      .where(
        and(
          eq(schema.sisterReimbursements.id, input.id),
          eq(schema.sisterReimbursements.ownerId, owner.id),
          eq(schema.sisterReimbursements.version, input.expectedVersion),
          isNull(schema.sisterReimbursements.deletedAt),
        ),
      )
      .returning({ id: schema.sisterReimbursements.id });
    if (!res.length) throw new ConflictError("reimbursement", input.id);
    await audit(tx, owner, "sister_reimbursement", input.id, "delete", null, null);
  });
}

/** A floating-rate change from a date. Earlier rates stay in force for earlier periods. */
export async function addRateChange(db: AnyDb, owner: Owner, input: { effectiveFrom: string; annualPercent: string; note: string | null }) {
  await db.transaction(async (tx) => {
    const loan = await getLoan(tx, owner);
    const ins = await tx
      .insert(schema.loanRates)
      .values({ ownerId: owner.id, loanId: loan.id, effectiveFrom: input.effectiveFrom, annualPercent: input.annualPercent, provenance: "entered by Krish", note: input.note })
      .onConflictDoNothing()
      .returning({ id: schema.loanRates.id });
    if (!ins.length) throw new UserFacingError(`There's already a rate effective ${input.effectiveFrom}.`);
    await audit(tx, owner, "loan_rate", ins[0]!.id, "create", null, input);
  });
}

export const SCENARIO_NAME = "My plan";

export async function loadScenario(db: AnyDb, owner: Owner): Promise<{ inputs: Scenario; version: number } | null> {
  const loan = await getLoan(db, owner);
  const [row] = await db
    .select()
    .from(schema.payoffScenarios)
    .where(and(eq(schema.payoffScenarios.ownerId, owner.id), eq(schema.payoffScenarios.loanId, loan.id), eq(schema.payoffScenarios.name, SCENARIO_NAME)));
  if (!row) return null;
  const parsed = ScenarioSchema.safeParse(row.inputs);
  return parsed.success ? { inputs: parsed.data, version: row.version } : null;
}

/** Save the planner inputs. expectedVersion null = first save. Stale saves conflict. */
export async function saveScenario(db: AnyDb, owner: Owner, input: { inputs: Scenario; expectedVersion: number | null }) {
  return db.transaction(async (tx) => {
    const loan = await getLoan(tx, owner);
    if (input.expectedVersion === null) {
      const ins = await tx
        .insert(schema.payoffScenarios)
        .values({ ownerId: owner.id, loanId: loan.id, name: SCENARIO_NAME, inputs: input.inputs, linkedMonth: input.inputs.linked?.month ?? null })
        .onConflictDoNothing()
        .returning({ version: schema.payoffScenarios.version });
      if (!ins.length) throw new ConflictError("plan", SCENARIO_NAME);
      return { version: ins[0]!.version };
    }
    const res = await tx
      .update(schema.payoffScenarios)
      .set({ inputs: input.inputs, linkedMonth: input.inputs.linked?.month ?? null, version: input.expectedVersion + 1, updatedAt: new Date() })
      .where(
        and(
          eq(schema.payoffScenarios.ownerId, owner.id),
          eq(schema.payoffScenarios.loanId, loan.id),
          eq(schema.payoffScenarios.name, SCENARIO_NAME),
          eq(schema.payoffScenarios.version, input.expectedVersion),
        ),
      )
      .returning({ version: schema.payoffScenarios.version });
    if (!res.length) throw new ConflictError("plan", SCENARIO_NAME);
    return { version: res[0]!.version };
  });
}
