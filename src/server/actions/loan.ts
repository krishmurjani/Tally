"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertIsoDate } from "@/engines/dates";
import { isParsableMinor, parseMinor } from "@/engines/money";
import { isDecimalString } from "@/engines/rational";
import { ScenarioSchema } from "@/engines/loan/scenario";
import {
  addPayment,
  addRateChange,
  addReimbursement,
  deletePayment,
  deleteReimbursement,
  markPaymentPaid,
  saveScenario,
  updatePayment,
  updateReimbursement,
} from "../repos/loan";
import { fetchLiveInrPerUsd } from "../fx";
import { ownerAction } from "./run";

const DateStr = z.string().refine((s) => {
  try {
    assertIsoDate(s);
    return true;
  } catch {
    return false;
  }
}, "Expected a date");
const Inr = z
  .string()
  .trim()
  .refine(isParsableMinor, "Enter an amount like 9846 or 9846.50")
  .transform(parseMinor);
const OptInr = z
  .string()
  .trim()
  .transform((s) => (s === "" ? null : s))
  .pipe(z.string().refine(isParsableMinor, "Enter an amount").transform(parseMinor).nullable());
const Version = z.number().int().min(1);
const Idem = z.string().min(8).max(100);
const Payer = z.enum(["krish", "sister", "other"]);

const PaymentFields = z.object({
  dueDate: DateStr,
  paidDate: DateStr.nullable(),
  amount: Inr.refine((v) => v > 0, "Amount must be more than ₹0"),
  payer: Payer.nullable(),
  type: z.enum(["pmii_emi", "repayment", "bounce"]),
  status: z.enum(["paid", "planned", "overdue", "bounced"]),
  reference: z.string().trim().max(120).nullable(),
  note: z.string().trim().max(500).nullable(),
  interest: OptInr,
  principal: OptInr,
});
const toPayment = (p: z.infer<typeof PaymentFields>) => ({
  dueDate: p.dueDate,
  paidDate: p.paidDate,
  amountMinor: p.amount,
  payer: p.payer,
  type: p.type,
  status: p.status,
  reference: p.reference || null,
  note: p.note || null,
  interestMinor: p.interest,
  principalMinor: p.principal,
});
const refresh = () => revalidatePath("/loan", "layout");

export async function addPaymentAction(input: unknown) {
  const res = await ownerAction(PaymentFields.extend({ idempotencyKey: Idem }), input, ({ db, owner, input }) => addPayment(db, owner, { ...toPayment(input), idempotencyKey: input.idempotencyKey }));
  if (res.ok) refresh();
  return res;
}

export async function updatePaymentAction(input: unknown) {
  const res = await ownerAction(PaymentFields.extend({ id: z.uuid(), expectedVersion: Version }), input, ({ db, owner, input }) =>
    updatePayment(db, owner, { ...toPayment(input), id: input.id, expectedVersion: input.expectedVersion }),
  );
  if (res.ok) refresh();
  return res;
}

export async function markPaymentPaidAction(input: unknown) {
  const res = await ownerAction(z.object({ id: z.uuid(), expectedVersion: Version, paidDate: DateStr, payer: Payer }), input, ({ db, owner, input }) => markPaymentPaid(db, owner, input));
  if (res.ok) refresh();
  return res;
}

export async function deletePaymentAction(input: unknown) {
  const res = await ownerAction(z.object({ id: z.uuid(), expectedVersion: Version }), input, ({ db, owner, input }) => deletePayment(db, owner, input));
  if (res.ok) refresh();
  return res;
}

const ReimbFields = z.object({ date: DateStr, amount: Inr, note: z.string().trim().max(500).nullable() });

export async function addReimbursementAction(input: unknown) {
  const res = await ownerAction(ReimbFields.extend({ idempotencyKey: Idem }), input, ({ db, owner, input }) =>
    addReimbursement(db, owner, { date: input.date, amountMinor: input.amount, note: input.note || null, idempotencyKey: input.idempotencyKey }),
  );
  if (res.ok) refresh();
  return res;
}

export async function updateReimbursementAction(input: unknown) {
  const res = await ownerAction(ReimbFields.extend({ id: z.uuid(), expectedVersion: Version }), input, ({ db, owner, input }) =>
    updateReimbursement(db, owner, { id: input.id, expectedVersion: input.expectedVersion, date: input.date, amountMinor: input.amount, note: input.note || null }),
  );
  if (res.ok) refresh();
  return res;
}

export async function deleteReimbursementAction(input: unknown) {
  const res = await ownerAction(z.object({ id: z.uuid(), expectedVersion: Version }), input, ({ db, owner, input }) => deleteReimbursement(db, owner, input));
  if (res.ok) refresh();
  return res;
}

export async function addRateChangeAction(input: unknown) {
  const res = await ownerAction(
    z.object({
      effectiveFrom: DateStr,
      annualPercent: z.string().trim().refine((s) => isDecimalString(s) && Number(s) >= 0 && Number(s) <= 100, "Enter a rate like 11.55"),
      note: z.string().trim().max(300).nullable(),
    }),
    input,
    ({ db, owner, input }) => addRateChange(db, owner, { ...input, note: input.note || null }),
  );
  if (res.ok) refresh();
  return res;
}

/** Debounced autosave from the planner. No revalidate: the client already holds the inputs. */
export async function saveScenarioAction(input: unknown) {
  return ownerAction(z.object({ inputs: ScenarioSchema, expectedVersion: Version.nullable() }), input, ({ db, owner, input }) => saveScenario(db, owner, input));
}

/** The live ₹ per $ for the planner's "Use live rate" button and its automatic refresh. */
export async function fetchFxAction() {
  return ownerAction(z.object({}), {}, async () => fetchLiveInrPerUsd());
}
