"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { approveInboxItem, approveReadyInbox, createApiToken, rejectInboxItem, revokeApiToken, setInboxCategory } from "../repos/inbox";
import { UserFacingError } from "../repos/errors";
import { ownerAction } from "./run";

/** The Inbox count lives in the nav, and approved items change the month pages: refresh everything. */
const refresh = () => revalidatePath("/", "layout");

async function userFacing<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof UserFacingError) throw e;
    throw e;
  }
}

export async function setInboxCategoryAction(input: unknown) {
  const res = await ownerAction(z.object({ id: z.uuid(), categoryId: z.uuid() }), input, ({ db, owner, input }) => userFacing(() => setInboxCategory(db, owner, input)));
  if (res.ok) refresh();
  return res;
}

export async function approveInboxAction(input: unknown) {
  const res = await ownerAction(z.object({ id: z.uuid() }), input, ({ db, owner, input }) => userFacing(() => approveInboxItem(db, owner, input.id)));
  if (res.ok) refresh();
  return res;
}

export async function rejectInboxAction(input: unknown) {
  const res = await ownerAction(z.object({ id: z.uuid() }), input, ({ db, owner, input }) => userFacing(() => rejectInboxItem(db, owner, input.id)));
  if (res.ok) refresh();
  return res;
}

export async function approveReadyAction() {
  const res = await ownerAction(z.object({}), {}, ({ db, owner }) => userFacing(() => approveReadyInbox(db, owner)));
  if (res.ok) refresh();
  return res;
}

/** Returns the token once, in the response. It isn't stored anywhere in readable form. */
export async function createApiTokenAction(input: unknown) {
  const res = await ownerAction(z.object({ name: z.string().trim().min(1).max(60) }), input, ({ db, owner, input }) => createApiToken(db, owner, input.name));
  if (res.ok) revalidatePath("/settings/api");
  return res;
}

export async function revokeApiTokenAction(input: unknown) {
  const res = await ownerAction(z.object({ id: z.uuid() }), input, ({ db, owner, input }) => revokeApiToken(db, owner, input.id));
  if (res.ok) revalidatePath("/settings/api");
  return res;
}
