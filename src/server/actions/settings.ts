"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { updateLargeThreshold } from "../repos/settings";
import { ownerAction } from "./run";

const Input = z.object({
  thresholdMinor: z.number().int().min(0).max(100_000_00),
  expectedVersion: z.number().int().min(1),
});

export async function saveLargeThreshold(input: unknown) {
  const res = await ownerAction(Input, input, ({ db, owner, input }) => updateLargeThreshold(db, owner, input));
  if (res.ok) revalidatePath("/settings");
  return res;
}
