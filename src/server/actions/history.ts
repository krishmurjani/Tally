"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { commitHistory, previewHistory } from "../repos/history";
import { ownerAction } from "./run";

const Text = z.string().min(1, "Choose a CSV file").max(1_000_000, "That file is too large for a month/category summary");

/** Dry run — nothing is written. */
export async function previewHistoryAction(input: unknown) {
  return ownerAction(z.object({ text: Text }), input, ({ db, owner, input }) => previewHistory(db, owner, input.text));
}

export async function importHistoryAction(input: unknown) {
  const res = await ownerAction(z.object({ text: Text }), input, ({ db, owner, input }) => commitHistory(db, owner, input.text));
  if (res.ok) revalidatePath("/", "layout");
  return res;
}
