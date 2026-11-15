/**
 * Sister reimbursement ledger — separate from lender payments. Reimbursing her never reduces
 * the loan. Owed = max(0, funded − reimbursed); credit = max(0, reimbursed − funded).
 */
import type { IsoDate } from "../dates";
import { countsAsPaid, paymentDate, type LenderPayment } from "./ledger";

export interface Reimbursement {
  id: string;
  date: IsoDate;
  amountMinor: number;
  kind: "opening" | "entry";
  note?: string | null;
}

export interface UnreimbursedItem {
  payment: LenderPayment;
  /** Portion of this payment not yet covered by reimbursements (oldest payments are covered first). */
  remainingMinor: number;
}

export interface SisterLedger {
  fundedMinor: number;
  reimbursedMinor: number;
  owedMinor: number;
  creditMinor: number;
  unreimbursed: UnreimbursedItem[];
}

export function sisterLedger(payments: LenderPayment[], reimbursements: Reimbursement[]): SisterLedger {
  const funded = payments
    .filter((p) => countsAsPaid(p) && p.payer === "sister")
    .sort((a, b) => (paymentDate(a) === paymentDate(b) ? a.id.localeCompare(b.id) : paymentDate(a) < paymentDate(b) ? -1 : 1));
  const fundedMinor = funded.reduce((s, p) => s + p.amountMinor, 0);
  const reimbursedMinor = reimbursements.reduce((s, r) => s + r.amountMinor, 0);

  // Allocate reimbursements to the oldest sister-funded payments first (FIFO).
  let pool = reimbursedMinor;
  const unreimbursed: UnreimbursedItem[] = [];
  for (const p of funded) {
    const covered = Math.min(pool, p.amountMinor);
    pool -= covered;
    if (covered < p.amountMinor) unreimbursed.push({ payment: p, remainingMinor: p.amountMinor - covered });
  }

  return {
    fundedMinor,
    reimbursedMinor,
    owedMinor: Math.max(0, fundedMinor - reimbursedMinor),
    creditMinor: Math.max(0, reimbursedMinor - fundedMinor),
    unreimbursed,
  };
}
