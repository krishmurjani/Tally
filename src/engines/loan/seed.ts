/**
 * HDFC Credila loan facts and payment history from the build spec, with provenance labels.
 * Amounts are INR paise (₹1 = 100). Used by tests and by the seed script.
 */
import { addMonths, dateInMonth, monthRange } from "../dates";
import type { LenderPayment, Payer, LenderPaymentType } from "./ledger";
import type { Reimbursement } from "./sister";

export const RUPEE = 100;
const inr = (rupees: number) => rupees * RUPEE;

export type Provenance = "lender statement" | "imported, unverified" | "stated by Krish" | "estimate";

export const LOAN_FACTS = {
  lender: "HDFC Credila",
  currency: "INR" as const,
  sanctionedMinor: inr(75_00_000),
  sanctionedProvenance: "stated by Krish" as Provenance,
  rate: { effectiveFrom: "2024-07-30", annualPercent: "11.55", provenance: "stated by Krish" as Provenance, note: "Floating rate, previously stated" },
  disbursements: [
    { date: "2024-07-30", amountMinor: inr(45_00_000), note: "Tranche 1", provenance: "lender statement" as Provenance },
    { date: "2024-07-30", amountMinor: inr(1_04_165), note: "Tranche 1 (part)", provenance: "lender statement" as Provenance },
    { date: "2024-07-30", amountMinor: inr(20_805), note: "Tranche 1 (part)", provenance: "lender statement" as Provenance },
    { date: "2025-01-13", amountMinor: inr(10_00_000), note: "Tranche 2", provenance: "lender statement" as Provenance },
    { date: "2025-08-19", amountMinor: inr(11_50_000), note: "Tranche 3", provenance: "lender statement" as Provenance },
    { date: "2026-01-23", amountMinor: inr(6_10_000), note: "Tranche 4", provenance: "lender statement" as Provenance },
  ],
  schedule: {
    issuedOn: "2026-09-14",
    provenance: "imported, unverified" as Provenance,
    openingBalanceMinor: inr(88_26_923),
    asOf: "2026-09-11",
    paymentDay: 11,
    phases: [
      { from: "2026-10-11", kind: "partial_interest" as const, paymentMinor: inr(9_846), label: "Partial interest (PMII)" },
      { from: "2027-09-11", kind: "emi" as const, paymentMinor: inr(1_29_537), label: "Full EMI" },
    ],
    partialInterestThrough: "2027-08",
    finalPaymentMonth: "2038-09",
  },
};

function series(
  idPrefix: string,
  fromMonth: string,
  toMonth: string,
  rupees: number,
  payer: Payer,
  type: LenderPaymentType,
  status: LenderPayment["status"] = "paid",
): LenderPayment[] {
  return monthRange(fromMonth, toMonth).map((m) => {
    const d = dateInMonth(m, 11);
    return {
      id: `${idPrefix}-${m}`,
      dueDate: d,
      paidDate: status === "paid" ? d : null,
      amountMinor: inr(rupees),
      payer,
      type,
      status,
      reference: null,
      note: null,
    };
  });
}

export const SEED_LENDER_PAYMENTS: LenderPayment[] = [
  ...series("pmii", "2024-08", "2025-01", 6_167, "sister", "pmii_emi"),
  ...series("pmii", "2025-02", "2025-08", 7_500, "sister", "pmii_emi"),
  ...series("pmii", "2025-09", "2025-11", 9_033, "sister", "pmii_emi"),
  {
    id: "bounce-2025-12-11",
    dueDate: "2025-12-11",
    paidDate: null,
    amountMinor: inr(9_033),
    payer: null,
    type: "bounce",
    status: "bounced",
    reference: null,
    note: "Bounced — audit only, excluded from totals",
  },
  ...[6_667, 1_533, 1_333].map(
    (r, i): LenderPayment => ({
      id: `pmii-2025-12-16-${i + 1}`,
      dueDate: "2025-12-11",
      paidDate: "2025-12-16",
      amountMinor: inr(r),
      payer: "sister",
      type: "pmii_emi",
      status: "paid",
      reference: null,
      note: "Paid after the 2025-12-11 bounce",
    }),
  ),
  ...series("pmii", "2026-01", "2026-01", 9_033, "sister", "pmii_emi"),
  ...series("pmii", "2026-02", "2026-07", 9_846, "sister", "pmii_emi"),
  ...series("repay", "2026-08", "2026-09", 9_846, "sister", "repayment"),
  ...series("pmii", "2026-10", "2026-11", 9_846, "krish", "pmii_emi"),
];

/** Planned future partial-interest payments by Krish until the schedule switches to the full EMI. */
export function plannedPayments(fromMonth: string, throughMonth = LOAN_FACTS.schedule.partialInterestThrough): LenderPayment[] {
  return series("planned", fromMonth, throughMonth, 9_846, "krish", "pmii_emi", "planned");
}

export const SEED_PLANNED_PAYMENTS = plannedPayments(addMonths("2026-11", 1));

export const SEED_REIMBURSEMENTS: Reimbursement[] = [
  {
    id: "reimb-opening",
    date: "2025-08-31",
    amountMinor: inr(89_502),
    kind: "opening",
    note: "Opening reconciliation — covers Aug 2024 – Aug 2025 payments",
  },
];
