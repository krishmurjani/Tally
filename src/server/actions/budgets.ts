"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { addMonths, isMonthKey } from "@/engines/dates";
import { budgetForMonth, createCategory, saveDefaultBudget, saveMonthBudget } from "../repos/budgets";
import { ownerAction } from "./run";

const Month = z.string().refine(isMonthKey, "Expected YYYY-MM");
const Amounts = z.array(z.object({ categoryId: z.uuid(), amountMinor: z.number().int().min(0).max(100_000_000) })).min(1);
const Expected = z.record(z.string(), z.number().int());

export async function saveBudgetAction(input: unknown) {
  const res = await ownerAction(
    z.object({ month: Month, scope: z.enum(["month", "default"]), amounts: Amounts, expected: Expected }),
    input,
    ({ db, owner, input }) =>
      input.scope === "month"
        ? saveMonthBudget(db, owner, { month: input.month, amounts: input.amounts, expected: input.expected })
        : saveDefaultBudget(db, owner, { fromMonth: input.month, amounts: input.amounts, expected: input.expected }),
  );
  if (res.ok) revalidatePath("/expenses", "layout");
  return res;
}

/** Previous month's effective budget, for "Copy last month". Read-only. */
export async function previousBudgetAction(input: unknown) {
  return ownerAction(z.object({ month: Month }), input, ({ db, owner, input }) => budgetForMonth(db, owner, addMonths(input.month, -1)));
}

export async function createCategoryAction(input: unknown) {
  const res = await ownerAction(z.object({ name: z.string().trim().min(1).max(60) }), input, ({ db, owner, input }) => createCategory(db, owner, input));
  if (res.ok) revalidatePath("/", "layout");
  return res;
}
