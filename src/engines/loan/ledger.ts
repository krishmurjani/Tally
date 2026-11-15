/**
 * Lender payment ledger (HDFC Credila). Planned items never count as paid; bounces are kept
 * for audit only and excluded from every total.
 */
import type { IsoDate } from "../dates";

export type Payer = "krish" | "sister" | "other";
export type LenderPaymentType = "pmii_emi" | "repayment" | "bounce";
export type LenderPaymentStatus = "paid" | "planned" | "overdue" | "bounced";

export interface LenderPayment {
  id: string;
  dueDate: IsoDate;
  paidDate: IsoDate | null;
  amountMinor: number; // INR paise
  payer: Payer | null;
  type: LenderPaymentType;
  status: LenderPaymentStatus;
  reference?: string | null;
  note?: string | null;
}

export const PAYMENT_TYPE_LABEL: Record<LenderPaymentType, string> = {
  pmii_emi: "PMII/EMI",
  repayment: "Repayment",
  bounce: "Bounce",
};

/** The date a payment counts on: when it was paid, else when it was due. */
export function paymentDate(p: LenderPayment): IsoDate {
  return p.paidDate ?? p.dueDate;
}

/** True only for money that actually reached the lender. */
export function countsAsPaid(p: LenderPayment): boolean {
  return p.status === "paid" && p.type !== "bounce";
}

/** A planned payment whose due date has passed shows as overdue (display only, never "paid"). */
export function effectiveStatus(p: LenderPayment, today: IsoDate): LenderPaymentStatus {
  if (p.type === "bounce") return "bounced";
  if (p.status === "planned" && p.dueDate < today) return "overdue";
  return p.status;
}

export interface PaidTotals {
  totalPaidMinor: number;
  byPayer: Record<Payer, number>;
  plannedMinor: number;
  bouncedCount: number;
}

export function paidTotals(payments: LenderPayment[]): PaidTotals {
  const byPayer: Record<Payer, number> = { krish: 0, sister: 0, other: 0 };
  let total = 0;
  let planned = 0;
  let bounced = 0;
  for (const p of payments) {
    if (p.type === "bounce" || p.status === "bounced") {
      bounced++;
      continue;
    }
    if (countsAsPaid(p)) {
      total += p.amountMinor;
      byPayer[p.payer ?? "other"] += p.amountMinor;
    } else if (p.status === "planned" || p.status === "overdue") {
      planned += p.amountMinor;
    }
  }
  return { totalPaidMinor: total, byPayer, plannedMinor: planned, bouncedCount: bounced };
}

/** Sister-funded total = sum of paid lender payments with payer Sister. */
export function sisterFundedMinor(payments: LenderPayment[]): number {
  return paidTotals(payments).byPayer.sister;
}

/** Paid payments dated within (after, upTo] — used by the projection to avoid double counting. */
export function paidBetween(payments: LenderPayment[], afterExclusive: IsoDate, upToInclusive: IsoDate): LenderPayment[] {
  return payments.filter((p) => countsAsPaid(p) && paymentDate(p) > afterExclusive && paymentDate(p) <= upToInclusive);
}
