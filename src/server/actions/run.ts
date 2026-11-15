import "server-only";
import { z } from "zod";
import { requireOwner } from "../auth-guard";
import { getDb, type Db } from "../db/client";
import { UnauthorizedError, type Owner } from "../owner-core";
import { ConflictError, NotFoundError, type ActionResult } from "../repos/errors";

/**
 * Wraps every server action: owner check FIRST, then input validation, then the work.
 * Maps known errors to a typed result so the UI shows real states (never "saved" early).
 */
export async function ownerAction<I, T>(
  schema: z.ZodType<I>,
  rawInput: unknown,
  work: (ctx: { db: Db; owner: Owner; input: I }) => Promise<T>,
): Promise<ActionResult<T>> {
  let owner: Owner;
  try {
    owner = await requireOwner();
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "unauthorized", message: e.message };
    throw e;
  }
  const parsed = schema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: "invalid", message: z.prettifyError(parsed.error) };
  try {
    return { ok: true, data: await work({ db: getDb(), owner, input: parsed.data }) };
  } catch (e) {
    if (e instanceof ConflictError) return { ok: false, error: "conflict", message: e.message };
    if (e instanceof NotFoundError) return { ok: false, error: "not_found", message: e.message };
    console.error(e);
    return { ok: false, error: "server", message: "Something went wrong on the server. Nothing was saved." };
  }
}
