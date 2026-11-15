"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertIsoDate } from "@/engines/dates";
import { isParsableMinor, parseMinor } from "@/engines/money";
import { addIncome, deleteIncome, updateIncome } from "../repos/income";
import { ownerAction } from "./run";

const DateStr = z.string().refine((s) => {
  try {
    assertIsoDate(s);
    return true;
  } catch {
    return false;
  }
}, "Expected a date");
const TakeHome = z
  .string()
  .trim()
  .refine(isParsableMinor, "Enter an amount like 2450.00")
  .transform(parseMinor)
  .refine((v) => v >= 0, "Income can't be negative");
const Fields = z.object({
  date: DateStr,
  amount: TakeHome,
  sourceType: z.enum(["employer", "cash", "gift_family", "gift_card", "other"]),
  employer: z.string().trim().max(120).nullable(),
  note: z.string().trim().max(500).nullable(),
});
const refresh = () => revalidatePath("/expenses", "layout");

export async function addIncomeAction(input: unknown) {
  const res = await ownerAction(Fields.extend({ idempotencyKey: z.string().min(8).max(100) }), input, ({ db, owner, input }) =>
    addIncome(db, owner, { date: input.date, amountMinor: input.amount, sourceType: input.sourceType, employer: input.employer || null, note: input.note || null, idempotencyKey: input.idempotencyKey }),
  );
  if (res.ok) refresh();
  return res;
}

export async function updateIncomeAction(input: unknown) {
  const res = await ownerAction(Fields.extend({ id: z.uuid(), expectedVersion: z.number().int().min(1) }), input, ({ db, owner, input }) =>
    updateIncome(db, owner, { id: input.id, expectedVersion: input.expectedVersion, date: input.date, amountMinor: input.amount, sourceType: input.sourceType, employer: input.employer || null, note: input.note || null }),
  );
  if (res.ok) refresh();
  return res;
}

export async function deleteIncomeAction(input: unknown) {
  const res = await ownerAction(z.object({ id: z.uuid(), expectedVersion: z.number().int().min(1) }), input, ({ db, owner, input }) => deleteIncome(db, owner, input));
  if (res.ok) refresh();
  return res;
}
