/**
 * Posting a shared Inbox item to Splitwise.
 *
 * Splitwise has no idempotency keys, so a repeated request makes a second expense that your friends see.
 * The guard is a small state machine:
 *   pending ──claim──► posting ──created──► approved (Splitwise id recorded)
 *                         │ ├─ Splitwise refused it ──► pending (reason kept; nothing was created)
 *                         │ └─ no clear answer ───────► stays "posting": nothing is retried until you check Splitwise
 *   posting ──"Check Splitwise"──► approved (found it) or pending (it isn't there; safe to post again)
 */
import { and, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { addDays, monthOf } from "@/engines/dates";
import { blockers } from "@/engines/inbox";
import { buildPostPlan, resolveTarget, type Group, type Person, type PostPlan } from "@/engines/splitwise-post";
import * as schema from "../db/schema";
import type { Owner } from "../owner-core";
import { SplitwiseAuthError, SplitwiseRejectedError, SplitwiseUncertainError, type SplitwiseApi } from "../splitwise/client";
import { apiRowKey } from "../splitwise/derive";
import { setCategoryOverride } from "./expenses";
import { NotFoundError, UserFacingError } from "./errors";

type AnyDb = NodePgDatabase<typeof schema>;
type Item = typeof schema.inboxItems.$inferSelect;

async function audit(db: AnyDb, owner: Owner, entity: string, entityId: string, action: string, before: unknown, after: unknown) {
  await db.insert(schema.auditLog).values({ ownerId: owner.id, entity, entityId, action, before, after });
}

export interface PostPreview {
  id: string;
  description: string;
  date: string;
  amountMinor: number;
  currency: string;
  ok: boolean;
  problems: string[];
  plan: PostPlan | null;
}

interface Lookups {
  me: Person;
  groups: Group[];
  friends: Person[];
}

/** One live look at Splitwise (who am I, my groups, my friends) shared by a whole batch. */
async function lookups(api: SplitwiseApi, needFriends: boolean): Promise<Lookups> {
  const [meRaw, groups, friends] = await Promise.all([api.getCurrentUser(), api.getGroupsWithMembers(), needFriends ? api.getFriends() : Promise.resolve([])]);
  return { me: { id: meRaw.id, firstName: meRaw.firstName, lastName: meRaw.lastName }, groups, friends };
}

async function closedMonths(db: AnyDb, owner: Owner): Promise<Set<string>> {
  const rows = await db.select({ month: schema.months.month }).from(schema.months).where(and(eq(schema.months.ownerId, owner.id), eq(schema.months.status, "closed")));
  return new Set(rows.map((r) => r.month));
}

function planFor(item: Item, l: Lookups, closed: Set<string>): { problems: string[]; plan: PostPlan | null } {
  const problems = blockers({ kind: "shared", currency: item.currency, categoryId: item.categoryId, monthClosed: closed.has(monthOf(item.date)), hasPayer: !!item.paidBy, hasSplit: !!item.split });
  const target = resolveTarget(item.groupName, l.groups, l.friends, l.me);
  if (!target.ok) return { problems: [...problems, ...target.problems], plan: null };
  const built = buildPostPlan(item, target.target, l.me);
  if (!built.ok) return { problems: [...problems, ...built.problems], plan: null };
  return { problems, plan: built.plan };
}

/** What would be sent, for the confirmation screen. Reads Splitwise; writes nothing anywhere. */
export async function previewPosts(db: AnyDb, owner: Owner, api: SplitwiseApi, ids: string[]): Promise<PostPreview[]> {
  const items = await db
    .select()
    .from(schema.inboxItems)
    .where(and(eq(schema.inboxItems.ownerId, owner.id), inArray(schema.inboxItems.id, ids), eq(schema.inboxItems.kind, "shared"), eq(schema.inboxItems.status, "pending")));
  if (items.length === 0) return [];
  const [l, closed] = await Promise.all([lookups(api, items.some((i) => !i.groupName)), closedMonths(db, owner)]);
  return items.map((item) => {
    const { problems, plan } = planFor(item, l, closed);
    return { id: item.id, description: item.description, date: item.date, amountMinor: item.amountMinor, currency: item.currency, ok: problems.length === 0 && plan !== null, problems, plan };
  });
}

/** Mark a successful post: approved, the Splitwise id kept, and the category you chose applied to the synced row. */
async function recordPosted(db: AnyDb, owner: Owner, item: Item, splitwiseExpenseId: number) {
  await db.transaction(async (tx) => {
    await tx
      .update(schema.inboxItems)
      .set({ status: "approved", splitwiseExpenseId, postError: null, decidedAt: new Date(), version: sql`${schema.inboxItems.version} + 1`, updatedAt: new Date() })
      .where(eq(schema.inboxItems.id, item.id));
    // The expense comes back with the next sync as a normal row; this keeps the category you chose rather than Splitwise's.
    if (item.categoryId) await setCategoryOverride(tx, owner, { rowKey: apiRowKey(splitwiseExpenseId), categoryId: item.categoryId });
    await audit(tx, owner, "inbox", item.id, "post_to_splitwise", null, { splitwiseExpenseId });
  });
}

async function release(db: AnyDb, id: string, message: string) {
  await db.update(schema.inboxItems).set({ status: "pending", postError: message, updatedAt: new Date() }).where(eq(schema.inboxItems.id, id));
}

export async function postSharedItem(db: AnyDb, owner: Owner, api: SplitwiseApi, id: string): Promise<{ splitwiseExpenseId: number }> {
  // 1. Claim it. Only one caller can move pending → posting, so a double-click or a second tab can't post twice.
  const claimed = await db
    .update(schema.inboxItems)
    .set({ status: "posting", postAttemptAt: new Date(), postError: null, version: sql`${schema.inboxItems.version} + 1`, updatedAt: new Date() })
    .where(and(eq(schema.inboxItems.id, id), eq(schema.inboxItems.ownerId, owner.id), eq(schema.inboxItems.kind, "shared"), eq(schema.inboxItems.status, "pending")))
    .returning();
  const item = claimed[0];
  if (!item) {
    const [row] = await db.select().from(schema.inboxItems).where(and(eq(schema.inboxItems.id, id), eq(schema.inboxItems.ownerId, owner.id)));
    if (!row) throw new NotFoundError("inbox item", id);
    if (row.kind !== "shared") throw new UserFacingError("Only shared expenses are posted to Splitwise.");
    throw new UserFacingError(row.status === "posting" ? "A post to Splitwise is already in progress or unconfirmed — use “Check Splitwise”." : `That item was already ${row.status}.`);
  }

  // 2. Work out exactly what to send, from Splitwise as it is right now.
  let plan: PostPlan;
  try {
    const [l, closed] = await Promise.all([lookups(api, !item.groupName), closedMonths(db, owner)]);
    const r = planFor(item, l, closed);
    if (!r.plan || r.problems.length > 0) {
      const msg = r.problems.join("; ") || "It can't be posted yet.";
      await release(db, id, msg);
      throw new UserFacingError(msg);
    }
    plan = r.plan;
  } catch (e) {
    if (e instanceof UserFacingError) throw e;
    await release(db, id, "Couldn't reach Splitwise to prepare it. Nothing was posted.");
    throw new UserFacingError("Couldn't reach Splitwise to prepare it. Nothing was posted.");
  }

  // 3. The one call that writes to Splitwise.
  let created: { id: number };
  try {
    created = await api.createExpense({
      cost: plan.cost,
      description: item.description,
      details: plan.details,
      date: plan.date,
      currencyCode: plan.currency,
      groupId: plan.groupId,
      shares: plan.shares.map((s) => ({ userId: s.userId, paid: s.paid, owed: s.owed })),
    });
  } catch (e) {
    if (e instanceof SplitwiseRejectedError || e instanceof SplitwiseAuthError) {
      const msg = e instanceof SplitwiseAuthError ? "Splitwise rejected the API key. Nothing was posted." : `${e.message}. Nothing was posted.`;
      await release(db, id, msg);
      throw new UserFacingError(msg);
    }
    // Unclear: it may exist. Leave it "posting" so nothing is retried blindly.
    const msg = `${e instanceof SplitwiseUncertainError ? e.message : "Unexpected error"}. Check Splitwise before posting again.`;
    await db.update(schema.inboxItems).set({ postError: msg, updatedAt: new Date() }).where(eq(schema.inboxItems.id, id));
    throw new UserFacingError(msg);
  }

  // 4. It exists. Record that. If this step fails the item stays "posting" and "Check Splitwise" will link it.
  try {
    await recordPosted(db, owner, item, created.id);
  } catch {
    await db.update(schema.inboxItems).set({ postError: "It was created in Splitwise, but Tally couldn't record it. Use “Check Splitwise”.", updatedAt: new Date() }).where(eq(schema.inboxItems.id, id));
    throw new UserFacingError("It was created in Splitwise, but Tally couldn't record it. Use “Check Splitwise” — don't post again.");
  }
  return { splitwiseExpenseId: created.id };
}

/** Post several, one at a time, stopping at the first one that doesn't go through. */
export async function postSharedBatch(db: AnyDb, owner: Owner, api: SplitwiseApi, ids: string[]): Promise<{ posted: number; stoppedBecause: string | null }> {
  let posted = 0;
  for (const id of ids) {
    try {
      await postSharedItem(db, owner, api, id);
      posted++;
    } catch (e) {
      if (e instanceof UserFacingError) return { posted, stoppedBecause: e.message };
      throw e;
    }
  }
  return { posted, stoppedBecause: null };
}

const two = (minor: number) => (minor / 100).toFixed(2);

/** For an unconfirmed post: look in Splitwise for the expense; link it if it's there, otherwise make the item postable again. */
export async function checkPostingItem(db: AnyDb, owner: Owner, api: SplitwiseApi, id: string): Promise<{ result: "linked" | "not_found" | "unclear"; splitwiseExpenseId?: number }> {
  const [item] = await db.select().from(schema.inboxItems).where(and(eq(schema.inboxItems.id, id), eq(schema.inboxItems.ownerId, owner.id), eq(schema.inboxItems.status, "posting")));
  if (!item) throw new UserFacingError("That item isn't waiting on a Splitwise check.");
  const found = await api.getExpenses({ datedAfter: addDays(item.date, -1), datedBefore: addDays(item.date, 2) });
  const linked = await db
    .select({ id: schema.inboxItems.splitwiseExpenseId })
    .from(schema.inboxItems)
    .where(and(eq(schema.inboxItems.ownerId, owner.id), isNotNull(schema.inboxItems.splitwiseExpenseId), ne(schema.inboxItems.id, item.id)));
  const taken = new Set(linked.map((r) => r.id));
  const matches = found.filter(({ parsed: e }) => !e.deleted_at && !e.payment && !taken.has(e.id) && e.description === item.description && e.cost === two(item.amountMinor) && e.currency_code === item.currency);
  if (matches.length === 1) {
    await recordPosted(db, owner, item, matches[0]!.parsed.id);
    return { result: "linked", splitwiseExpenseId: matches[0]!.parsed.id };
  }
  if (matches.length > 1) {
    await db.update(schema.inboxItems).set({ postError: "More than one matching expense in Splitwise — pick the right one there, then reject this draft.", updatedAt: new Date() }).where(eq(schema.inboxItems.id, id));
    return { result: "unclear" };
  }
  await release(db, id, "Splitwise doesn't have it, so it's safe to post again.");
  return { result: "not_found" };
}
