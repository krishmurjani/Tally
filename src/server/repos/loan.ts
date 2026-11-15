import { and, asc, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { LenderPayment } from "@/engines/loan/ledger";
import type { Reimbursement } from "@/engines/loan/sister";
import * as schema from "../db/schema";
import type { Owner } from "../owner-core";

type AnyDb = NodePgDatabase<typeof schema>;

export async function loadLoanLedgers(db: AnyDb, owner: Owner): Promise<{ payments: LenderPayment[]; reimbursements: Reimbursement[] }> {
  const pays = await db
    .select()
    .from(schema.lenderPayments)
    .where(and(eq(schema.lenderPayments.ownerId, owner.id), isNull(schema.lenderPayments.deletedAt)))
    .orderBy(asc(schema.lenderPayments.dueDate));
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
    })),
    reimbursements: reimb.map((r) => ({ id: r.id, date: r.date, amountMinor: r.amountMinor, kind: r.kind, note: r.note })),
  };
}
