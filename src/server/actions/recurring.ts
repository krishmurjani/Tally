"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isMonthKey } from "@/engines/dates";
import { isParsableMinor, parseMinor } from "@/engines/money";
import { createRecurring, deleteRecurring, setRecurringEnd, setRecurringFrom, setRecurringOverride } from "../repos/recurring";
import { ownerAction } from "./run";

const Month = z.string().refine(isMonthKey, "Pick a month");
const Amount = z
  .string()
  .trim()
  .refine(isParsableMinor, "Enter an amount like 41.66")
  .transform(parseMinor);
const Series = z.string().min(1).max(80);
const Day = z.number().int().min(1).max(31);

/** The new tab, the transactions list and the totals all read these rules. */
const refresh = () => revalidatePath("/expenses/[month]", "layout");

export async function createRecurringAction(input: unknown) {
  const res = await ownerAction(
    z.object({ name: z.string().trim().min(1).max(80), categoryId: z.uuid(), amount: Amount, dayOfMonth: Day, effectiveFrom: Month, effectiveTo: Month.nullable() }),
    input,
    ({ db, owner, input }) => createRecurring(db, owner, { name: input.name, categoryId: input.categoryId, amountMinor: input.amount, dayOfMonth: input.dayOfMonth, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo }),
  );
  if (res.ok) refresh();
  return res;
}

export async function changeRecurringFromAction(input: unknown) {
  const res = await ownerAction(
    z.object({ series: Series, from: Month, amount: Amount, name: z.string().trim().min(1).max(80).optional(), categoryId: z.uuid().optional(), dayOfMonth: Day.optional() }),
    input,
    ({ db, owner, input }) => setRecurringFrom(db, owner, { series: input.series, from: input.from, amountMinor: input.amount, name: input.name, categoryId: input.categoryId, dayOfMonth: input.dayOfMonth }),
  );
  if (res.ok) refresh();
  return res;
}

export async function setRecurringEndAction(input: unknown) {
  const res = await ownerAction(z.object({ series: Series, lastMonth: Month.nullable() }), input, ({ db, owner, input }) => setRecurringEnd(db, owner, input));
  if (res.ok) refresh();
  return res;
}

/** amount null = skip the month; clear = back to normal. */
export async function setRecurringOverrideAction(input: unknown) {
  const res = await ownerAction(
    z.object({ series: Series, month: Month, amount: Amount.nullable(), note: z.string().trim().max(200).nullable(), clear: z.boolean().optional() }),
    input,
    ({ db, owner, input }) => setRecurringOverride(db, owner, { series: input.series, month: input.month, amountMinor: input.amount, note: input.note || null, clear: input.clear }),
  );
  if (res.ok) refresh();
  return res;
}

export async function deleteRecurringAction(input: unknown) {
  const res = await ownerAction(z.object({ series: Series }), input, ({ db, owner, input }) => deleteRecurring(db, owner, input.series));
  if (res.ok) refresh();
  return res;
}
