"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { approveInboxItem, approveReadyInbox, createApiToken, deleteAlias, rejectInboxItem, revokeApiToken, saveAlias, setInboxCategory } from "../repos/inbox";
import { checkPostingItem, postSharedBatch, previewPosts } from "../repos/inbox-post";
import { createSplitwiseClient, SplitwiseAuthError, SplitwiseError } from "../splitwise/client";
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

// ---------------------------------------------------------------------------------------------- Splitwise

function splitwise() {
  const key = process.env.SPLITWISE_API_KEY;
  if (!key) throw new UserFacingError("Splitwise isn't connected yet — add SPLITWISE_API_KEY on the server.");
  return createSplitwiseClient({ apiKey: key });
}

async function viaSplitwise<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof SplitwiseAuthError) throw new UserFacingError("Splitwise rejected the API key (check SPLITWISE_API_KEY).");
    if (e instanceof SplitwiseError && !(e instanceof SplitwiseAuthError)) throw new UserFacingError(`Splitwise: ${e.message}`);
    throw e;
  }
}

const Ids = z.object({ ids: z.array(z.uuid()).min(1).max(25) });

/** What would be posted — read-only. Reads Splitwise to find the group and people; writes nothing. */
export async function previewSplitwisePostsAction(input: unknown) {
  return ownerAction(Ids, input, ({ db, owner, input }) => viaSplitwise(() => previewPosts(db, owner, splitwise(), input.ids)));
}

/** Creates the expenses in Splitwise. Only ever called from the confirmation screen. */
export async function postToSplitwiseAction(input: unknown) {
  const res = await ownerAction(Ids, input, ({ db, owner, input }) => viaSplitwise(() => postSharedBatch(db, owner, splitwise(), input.ids)));
  revalidatePath("/", "layout");
  return res;
}

export async function checkPostingAction(input: unknown) {
  const res = await ownerAction(z.object({ id: z.uuid() }), input, ({ db, owner, input }) => viaSplitwise(() => checkPostingItem(db, owner, splitwise(), input.id)));
  revalidatePath("/", "layout");
  return res;
}

/** "When anyone says <name>, they mean this Splitwise person." Saved once from the posting screen. */
export async function saveAliasAction(input: unknown) {
  return ownerAction(z.object({ name: z.string().trim().min(1).max(100), splitwiseUserId: z.number().int().positive(), displayName: z.string().trim().min(1).max(120) }), input, ({ db, owner, input }) => saveAlias(db, owner, input));
}

export async function deleteAliasAction(input: unknown) {
  const res = await ownerAction(z.object({ id: z.uuid() }), input, ({ db, owner, input }) => deleteAlias(db, owner, input.id));
  if (res.ok) revalidatePath("/settings/api");
  return res;
}
