"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertIsoDate, isMonthKey, monthOf } from "@/engines/dates";
import { isParsableMinor, parseMinor } from "@/engines/money";
import { importCsvFiles, MAX_CSV_BYTES } from "../repos/csv-import";
import { markNotExpense, markNotExpenseBulk, pinDecisionTo, revokeDecision } from "../repos/decisions";
import { UserFacingError } from "../repos/errors";
import {
  addManualExpense,
  confirmUsdAmount,
  deleteManualExpense,
  mapSplitwiseCategory,
  resetCategoryOverride,
  setCategoryOverride,
  setCategoryOverridesBulk,
  setLargeDismissed,
  updateManualExpense,
} from "../repos/expenses";
import { acceptChanges, closeMonth, ClosingBlockedError, keepSnapshot, reopenMonth, setMonthSource } from "../repos/months";
import { createSplitwiseClient, SplitwiseAuthError, SplitwiseError } from "../splitwise/client";
import { SourceConflictError, syncChanges, syncMonth } from "../splitwise/sync";
import { ownerAction } from "./run";

const Month = z.string().refine(isMonthKey, "Expected YYYY-MM");
const Version = z.number().int().min(1);
const IdemKey = z.string().min(8).max(100);
const Amount = z
  .string()
  .trim()
  .refine(isParsableMinor, "Enter an amount like 12.34")
  .transform(parseMinor);
const DateStr = z.string().refine((s) => {
  try {
    assertIsoDate(s);
    return true;
  } catch {
    return false;
  }
}, "Expected a date");

const refresh = () => revalidatePath("/expenses/[month]", "page");

/** Translate domain errors into messages the UI can show. */
async function userFacing<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof SourceConflictError || e instanceof ClosingBlockedError) throw new UserFacingError(e.message);
    if (e instanceof SplitwiseAuthError) throw new UserFacingError("Splitwise rejected the API key (check SPLITWISE_API_KEY).");
    if (e instanceof SplitwiseError) throw new UserFacingError(`Splitwise sync failed: ${e.message}. Nothing was changed.`);
    throw e;
  }
}

export async function syncMonthAction(input: unknown) {
  const res = await ownerAction(z.object({ month: Month }), input, ({ db, owner, input }) =>
    userFacing(async () => {
      const key = process.env.SPLITWISE_API_KEY;
      if (!key) throw new UserFacingError("Splitwise isn't connected yet — add SPLITWISE_API_KEY on the server. You can import CSV exports meanwhile.");
      const api = createSplitwiseClient({ apiKey: key });
      const month = await syncMonth(db, owner, api, input.month);
      const changes = await syncChanges(db, owner, api);
      return { month, changes };
    }),
  );
  if (res.ok) refresh();
  return res;
}

export async function markNotExpenseAction(input: unknown) {
  const res = await ownerAction(
    z.object({ rowKey: z.string().min(3).max(300), reason: z.string().max(300).nullable(), idempotencyKey: IdemKey }),
    input,
    ({ db, owner, input }) => markNotExpense(db, owner, input),
  );
  if (res.ok) refresh();
  return res;
}

const RowKeys = z.array(z.string().min(3).max(300)).min(1).max(200);

export async function setCategoryBulkAction(input: unknown) {
  const res = await ownerAction(z.object({ rowKeys: RowKeys, categoryId: z.uuid() }), input, ({ db, owner, input }) => setCategoryOverridesBulk(db, owner, input));
  if (res.ok) refresh();
  return res;
}

export async function markNotExpenseBulkAction(input: unknown) {
  const res = await ownerAction(z.object({ rowKeys: RowKeys, reason: z.string().max(300).nullable(), idempotencyKey: IdemKey }), input, ({ db, owner, input }) => markNotExpenseBulk(db, owner, input));
  if (res.ok) refresh();
  return res;
}

export async function undoDecisionAction(input: unknown) {
  const res = await ownerAction(z.object({ id: z.uuid(), expectedVersion: Version }), input, ({ db, owner, input }) => revokeDecision(db, owner, input));
  if (res.ok) refresh();
  return res;
}

export async function pinDecisionAction(input: unknown) {
  const res = await ownerAction(z.object({ id: z.uuid(), rowKey: z.string().min(3).max(300), expectedVersion: Version }), input, ({ db, owner, input }) =>
    pinDecisionTo(db, owner, input),
  );
  if (res.ok) refresh();
  return res;
}

export async function setCategoryAction(input: unknown) {
  const res = await ownerAction(z.object({ rowKey: z.string().min(3).max(300), categoryId: z.uuid() }), input, ({ db, owner, input }) =>
    setCategoryOverride(db, owner, input),
  );
  if (res.ok) refresh();
  return res;
}

export async function resetCategoryAction(input: unknown) {
  const res = await ownerAction(z.object({ rowKey: z.string().min(3).max(300) }), input, ({ db, owner, input }) => resetCategoryOverride(db, owner, input));
  if (res.ok) refresh();
  return res;
}

export async function mapSplitwiseCategoryAction(input: unknown) {
  const res = await ownerAction(z.object({ splitwiseName: z.string().min(1).max(100), categoryId: z.uuid() }), input, ({ db, owner, input }) =>
    mapSplitwiseCategory(db, owner, input),
  );
  if (res.ok) refresh();
  return res;
}

const ManualFields = z.object({
  date: DateStr,
  description: z.string().trim().min(1).max(200),
  categoryId: z.uuid(),
  amount: Amount,
  note: z.string().trim().max(500).nullable(),
  month: Month,
});

function checkMonth(v: { date: string; month: string }) {
  if (monthOf(v.date) !== v.month) throw new UserFacingError(`The date must be within ${v.month}.`);
}

export async function addManualExpenseAction(input: unknown) {
  const res = await ownerAction(ManualFields.extend({ idempotencyKey: IdemKey }), input, async ({ db, owner, input }) => {
    checkMonth(input);
    const row = await addManualExpense(db, owner, { date: input.date, description: input.description, categoryId: input.categoryId, amountMinor: input.amount, note: input.note || null, idempotencyKey: input.idempotencyKey });
    return { id: row.id };
  });
  if (res.ok) refresh();
  return res;
}

export async function updateManualExpenseAction(input: unknown) {
  const res = await ownerAction(ManualFields.extend({ id: z.uuid(), expectedVersion: Version }), input, async ({ db, owner, input }) => {
    checkMonth(input);
    const row = await updateManualExpense(db, owner, { id: input.id, expectedVersion: input.expectedVersion, date: input.date, description: input.description, categoryId: input.categoryId, amountMinor: input.amount, note: input.note || null });
    return { id: row.id, version: row.version };
  });
  if (res.ok) refresh();
  return res;
}

export async function deleteManualExpenseAction(input: unknown) {
  const res = await ownerAction(z.object({ id: z.uuid(), expectedVersion: Version }), input, ({ db, owner, input }) => deleteManualExpense(db, owner, input));
  if (res.ok) refresh();
  return res;
}

export async function closeMonthAction(input: unknown) {
  const res = await ownerAction(z.object({ month: Month, expectedVersion: Version.nullable() }), input, async ({ db, owner, input }) =>
    userFacing(async () => ({ totalMinor: (await closeMonth(db, owner, input)).totalMinor })),
  );
  if (res.ok) refresh();
  return res;
}

export async function acceptChangesAction(input: unknown) {
  const res = await ownerAction(z.object({ month: Month, expectedVersion: Version }), input, async ({ db, owner, input }) =>
    userFacing(async () => ({ totalMinor: (await acceptChanges(db, owner, input)).totalMinor })),
  );
  if (res.ok) refresh();
  return res;
}

export async function reopenMonthAction(input: unknown) {
  const res = await ownerAction(z.object({ month: Month, expectedVersion: Version }), input, ({ db, owner, input }) => reopenMonth(db, owner, input));
  if (res.ok) refresh();
  return res;
}

export async function keepSnapshotAction(input: unknown) {
  const res = await ownerAction(z.object({ month: Month, expectedVersion: Version }), input, ({ db, owner, input }) => keepSnapshot(db, owner, input));
  if (res.ok) refresh();
  return res;
}

export async function setLargeDismissedAction(input: unknown) {
  const res = await ownerAction(z.object({ rowKey: z.string().min(3).max(300), dismissed: z.boolean() }), input, ({ db, owner, input }) => setLargeDismissed(db, owner, input));
  if (res.ok) refresh();
  return res;
}

export async function confirmUsdAction(input: unknown) {
  const res = await ownerAction(z.object({ splitwiseId: z.number().int().positive(), usdAmount: Amount, note: z.string().max(300).nullable() }), input, ({ db, owner, input }) =>
    confirmUsdAmount(db, owner, { splitwiseId: input.splitwiseId, usdMinor: input.usdAmount, note: input.note }),
  );
  if (res.ok) refresh();
  return res;
}

export async function setMonthSourceAction(input: unknown) {
  const res = await ownerAction(z.object({ month: Month, source: z.enum(["api", "csv"]) }), input, ({ db, owner, input }) => setMonthSource(db, owner, input));
  if (res.ok) refresh();
  return res;
}

export async function importCsvAction(formData: FormData) {
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const res = await ownerAction(z.array(z.instanceof(File)).min(1, "Choose at least one CSV file").max(30), files, async ({ db, owner, input }) => {
    const tooBig = input.find((f) => f.size > MAX_CSV_BYTES);
    if (tooBig) throw new UserFacingError(`${tooBig.name} is too large for a Splitwise export.`);
    return importCsvFiles(db, owner, await Promise.all(input.map(async (f) => ({ name: f.name, content: await f.text() }))));
  });
  if (res.ok) revalidatePath("/expenses", "layout");
  return res;
}
