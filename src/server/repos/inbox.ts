import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { monthOf } from "@/engines/dates";
import { blockers, MAX_ITEMS_PER_REQUEST, parseInboxItem, type ParsedInboxItem } from "@/engines/inbox";
import * as schema from "../db/schema";
import type { Owner } from "../owner-core";
import { canonicalJson } from "../splitwise/derive";
import { addManualExpense } from "./expenses";
import { NotFoundError, UserFacingError } from "./errors";

type AnyDb = NodePgDatabase<typeof schema>;

async function audit(db: AnyDb, owner: Owner, entity: string, entityId: string, action: string, before: unknown, after: unknown) {
  await db.insert(schema.auditLog).values({ ownerId: owner.id, entity, entityId, action, before, after });
}

// ---------------------------------------------------------------------------------------------- tokens

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** A new token: "tly_" + 256 random bits. The plaintext is returned once and never stored. */
export async function createApiToken(db: AnyDb, owner: Owner, name: string) {
  const token = `tly_${randomBytes(32).toString("base64url")}`;
  const [row] = await db
    .insert(schema.apiTokens)
    .values({ ownerId: owner.id, name: name.trim(), tokenHash: hashToken(token), prefix: token.slice(0, 8) })
    .returning({ id: schema.apiTokens.id, prefix: schema.apiTokens.prefix });
  await audit(db, owner, "api_token", row!.id, "create", null, { name: name.trim() });
  return { id: row!.id, prefix: row!.prefix, token };
}

export async function listApiTokens(db: AnyDb, owner: Owner) {
  return db
    .select({ id: schema.apiTokens.id, name: schema.apiTokens.name, prefix: schema.apiTokens.prefix, lastUsedAt: schema.apiTokens.lastUsedAt, revokedAt: schema.apiTokens.revokedAt, createdAt: schema.apiTokens.createdAt })
    .from(schema.apiTokens)
    .where(eq(schema.apiTokens.ownerId, owner.id))
    .orderBy(desc(schema.apiTokens.createdAt));
}

export async function revokeApiToken(db: AnyDb, owner: Owner, id: string) {
  const res = await db
    .update(schema.apiTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.apiTokens.id, id), eq(schema.apiTokens.ownerId, owner.id), isNull(schema.apiTokens.revokedAt)))
    .returning({ id: schema.apiTokens.id });
  if (!res.length) throw new NotFoundError("API token", id);
  await audit(db, owner, "api_token", id, "revoke", null, null);
}

/** The owner a "Bearer tly_…" header belongs to, or null. Same answer for a wrong, malformed or revoked token. */
export async function ownerFromBearer(db: AnyDb, authorization: string | null): Promise<Owner | null> {
  const m = /^Bearer\s+(tly_[A-Za-z0-9_-]{20,100})$/.exec(authorization?.trim() ?? "");
  if (!m) return null;
  const [row] = await db
    .select({ tokenId: schema.apiTokens.id, ownerId: schema.owners.id, email: schema.owners.email })
    .from(schema.apiTokens)
    .innerJoin(schema.owners, eq(schema.owners.id, schema.apiTokens.ownerId))
    .where(and(eq(schema.apiTokens.tokenHash, hashToken(m[1]!)), isNull(schema.apiTokens.revokedAt)))
    .limit(1);
  if (!row) return null;
  await db.update(schema.apiTokens).set({ lastUsedAt: new Date() }).where(eq(schema.apiTokens.id, row.tokenId));
  return Object.freeze({ id: row.ownerId, email: row.email });
}

// ---------------------------------------------------------------------------------------------- ingest

export type IngestStatus = "created" | "duplicate_ignored" | "invalid" | "would_create" | "would_ignore_duplicate";

export interface IngestResult {
  externalId: string | null;
  status: IngestStatus;
  /** Why the item was rejected (status "invalid"). */
  errors?: string[];
  /** Saved as a draft, but this is why it can't be approved yet. */
  blockers?: string[];
  notes?: string[];
  /** For duplicates: what became of the original, and whether this resend differs from it. */
  existing?: { status: "pending" | "approved" | "rejected" | "posting"; differs: boolean };
  id?: string;
}

async function closedMonths(db: AnyDb, owner: Owner): Promise<Set<string>> {
  const rows = await db.select({ month: schema.months.month }).from(schema.months).where(and(eq(schema.months.ownerId, owner.id), eq(schema.months.status, "closed")));
  return new Set(rows.map((r) => r.month));
}

async function categoryIndex(db: AnyDb, owner: Owner) {
  const rows = await db.select({ id: schema.categories.id, name: schema.categories.name }).from(schema.categories).where(and(eq(schema.categories.ownerId, owner.id), eq(schema.categories.archived, false)));
  return new Map(rows.map((r) => [r.name.trim().toLowerCase(), r.id]));
}

export async function ingestInbox(db: AnyDb, owner: Owner, rawItems: unknown[], opts: { dryRun: boolean }): Promise<IngestResult[]> {
  if (rawItems.length === 0) throw new UserFacingError("Send at least one item.");
  if (rawItems.length > MAX_ITEMS_PER_REQUEST) throw new UserFacingError(`Send at most ${MAX_ITEMS_PER_REQUEST} items per request.`);
  const [cats, closed] = await Promise.all([categoryIndex(db, owner), closedMonths(db, owner)]);
  const parsed = rawItems.map((raw) => ({ raw, p: parseInboxItem(raw) }));
  const ids = parsed.flatMap((x) => (x.p.ok ? [x.p.item.externalId] : []));
  const existing = ids.length
    ? await db.select({ externalId: schema.inboxItems.externalId, status: schema.inboxItems.status, raw: schema.inboxItems.raw }).from(schema.inboxItems).where(and(eq(schema.inboxItems.ownerId, owner.id), inArray(schema.inboxItems.externalId, ids)))
    : [];
  const byId = new Map(existing.map((e) => [e.externalId, e]));

  const results: IngestResult[] = [];
  const toInsert: { index: number; item: ParsedInboxItem; raw: unknown; categoryId: string | null }[] = [];
  const seen = new Set<string>();
  parsed.forEach(({ raw, p }, index) => {
    if (!p.ok) {
      results[index] = { externalId: p.externalId, status: "invalid", errors: p.errors };
      return;
    }
    const item = p.item;
    const dupe = byId.get(item.externalId);
    if (dupe) {
      results[index] = { externalId: item.externalId, status: opts.dryRun ? "would_ignore_duplicate" : "duplicate_ignored", existing: { status: dupe.status, differs: canonicalJson(dupe.raw) !== canonicalJson(raw) } };
      return;
    }
    if (seen.has(item.externalId)) {
      results[index] = { externalId: item.externalId, status: opts.dryRun ? "would_ignore_duplicate" : "duplicate_ignored", notes: ["Sent twice in this request; the first one was used."] };
      return;
    }
    seen.add(item.externalId);
    const categoryId = item.categoryName ? (cats.get(item.categoryName.toLowerCase()) ?? null) : null;
    const notes = item.categoryName && !categoryId ? [`Unknown category "${item.categoryName}" — it will be chosen in the Inbox`] : [];
    results[index] = {
      externalId: item.externalId,
      status: opts.dryRun ? "would_create" : "created",
      blockers: blockers({ kind: item.kind, currency: item.currency, categoryId, monthClosed: closed.has(monthOf(item.date)), hasPayer: !!item.paidBy, hasSplit: !!item.split }),
      ...(notes.length ? { notes } : {}),
    };
    toInsert.push({ index, item, raw, categoryId });
  });

  if (opts.dryRun || toInsert.length === 0) return results;

  await db.transaction(async (tx) => {
    for (const { index, item, raw, categoryId } of toInsert) {
      const ins = await tx
        .insert(schema.inboxItems)
        .values({
          ownerId: owner.id,
          externalId: item.externalId,
          date: item.date,
          description: item.description,
          amountMinor: item.amountMinor,
          currency: item.currency,
          kind: item.kind,
          categoryName: item.categoryName,
          categoryId,
          note: item.note,
          groupName: item.groupName,
          paidBy: item.paidBy,
          split: item.split,
          raw: raw as object,
        })
        .onConflictDoNothing({ target: [schema.inboxItems.ownerId, schema.inboxItems.externalId] })
        .returning({ id: schema.inboxItems.id });
      if (ins[0]) results[index] = { ...results[index]!, id: ins[0].id };
      else results[index] = { externalId: item.externalId, status: "duplicate_ignored" }; // lost a race with an identical request
    }
    await audit(tx, owner, "inbox", "batch", "ingest", null, { received: rawItems.length, created: results.filter((r) => r.status === "created").length });
  });
  return results;
}

// ---------------------------------------------------------------------------------------------- reading

export type InboxRow = typeof schema.inboxItems.$inferSelect & { blockers: string[] };

export async function loadInbox(db: AnyDb, owner: Owner) {
  const [rows, closed, categories] = await Promise.all([
    db.select().from(schema.inboxItems).where(eq(schema.inboxItems.ownerId, owner.id)).orderBy(desc(schema.inboxItems.date), asc(schema.inboxItems.createdAt)),
    closedMonths(db, owner),
    db.select({ id: schema.categories.id, name: schema.categories.name }).from(schema.categories).where(and(eq(schema.categories.ownerId, owner.id), eq(schema.categories.archived, false))).orderBy(asc(schema.categories.sortOrder)),
  ]);
  const withBlockers = (r: (typeof rows)[number]): InboxRow => ({ ...r, blockers: r.status === "pending" ? blockers({ kind: r.kind, currency: r.currency, categoryId: r.categoryId, monthClosed: closed.has(monthOf(r.date)), hasPayer: !!r.paidBy, hasSplit: !!r.split }) : [] });
  const pending = rows.filter((r) => r.status === "pending").map(withBlockers);
  // A post that started and never got a clear answer: needs a look at Splitwise before anything else happens to it.
  const posting = rows.filter((r) => r.status === "posting").map(withBlockers);
  const recent = rows
    .filter((r) => r.status === "approved" || r.status === "rejected")
    .sort((a, b) => (b.decidedAt?.getTime() ?? 0) - (a.decidedAt?.getTime() ?? 0))
    .slice(0, 15)
    .map(withBlockers);
  return { pending, posting, recent, categories };
}

export async function pendingInboxCount(db: AnyDb, owner: Owner): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.inboxItems).where(and(eq(schema.inboxItems.ownerId, owner.id), eq(schema.inboxItems.status, "pending")));
  return r?.n ?? 0;
}

// ---------------------------------------------------------------------------------------------- deciding

async function pendingItem(tx: AnyDb, owner: Owner, id: string) {
  const [row] = await tx.select().from(schema.inboxItems).where(and(eq(schema.inboxItems.id, id), eq(schema.inboxItems.ownerId, owner.id)));
  if (!row) throw new NotFoundError("inbox item", id);
  if (row.status !== "pending") throw new UserFacingError(`That item was already ${row.status}.`);
  return row;
}

export async function setInboxCategory(db: AnyDb, owner: Owner, input: { id: string; categoryId: string }) {
  await db.transaction(async (tx) => {
    const item = await pendingItem(tx, owner, input.id);
    const [cat] = await tx.select().from(schema.categories).where(and(eq(schema.categories.id, input.categoryId), eq(schema.categories.ownerId, owner.id)));
    if (!cat) throw new NotFoundError("category", input.categoryId);
    await tx.update(schema.inboxItems).set({ categoryId: cat.id, version: item.version + 1, updatedAt: new Date() }).where(eq(schema.inboxItems.id, item.id));
    await audit(tx, owner, "inbox", item.id, "set_category", { categoryId: item.categoryId }, { category: cat.name });
  });
}

/** Approve one item: it becomes a private expense in Tally. Idempotent per item. */
export async function approveInboxItem(db: AnyDb, owner: Owner, id: string): Promise<{ manualExpenseId: string }> {
  return db.transaction(async (tx) => {
    const item = await pendingItem(tx, owner, id);
    const closed = await closedMonths(tx, owner);
    if (item.kind === "shared") throw new UserFacingError("Shared expenses are posted to Splitwise, not approved into Tally.");
    const why = blockers({ kind: item.kind, currency: item.currency, categoryId: item.categoryId, monthClosed: closed.has(monthOf(item.date)) });
    if (why.length) throw new UserFacingError(why[0]!);
    const expense = await addManualExpense(tx, owner, {
      date: item.date,
      description: item.description,
      categoryId: item.categoryId!,
      amountMinor: item.amountMinor,
      note: item.note,
      idempotencyKey: `inbox:${item.id}`,
    });
    await tx.update(schema.inboxItems).set({ status: "approved", manualExpenseId: expense.id, decidedAt: new Date(), version: item.version + 1, updatedAt: new Date() }).where(eq(schema.inboxItems.id, item.id));
    await audit(tx, owner, "inbox", item.id, "approve", null, { manualExpenseId: expense.id });
    return { manualExpenseId: expense.id };
  });
}

export async function rejectInboxItem(db: AnyDb, owner: Owner, id: string) {
  await db.transaction(async (tx) => {
    const item = await pendingItem(tx, owner, id);
    await tx.update(schema.inboxItems).set({ status: "rejected", decidedAt: new Date(), version: item.version + 1, updatedAt: new Date() }).where(eq(schema.inboxItems.id, item.id));
    await audit(tx, owner, "inbox", item.id, "reject", null, null);
  });
}

/** Approve every pending item that has nothing blocking it; the rest stay for review. */
export async function approveReadyInbox(db: AnyDb, owner: Owner): Promise<{ approved: number; left: number }> {
  const { pending } = await loadInbox(db, owner);
  let approved = 0;
  for (const row of pending) {
    if (row.blockers.length || row.kind !== "private") continue; // shared ones are posted, with a preview, not bulk-approved
    await approveInboxItem(db, owner, row.id);
    approved++;
  }
  return { approved, left: pending.length - approved };
}


// ---------------------------------------------------------------------------------------------- name aliases

import { aliasKey, type Aliases } from "@/engines/splitwise-post";

export async function loadAliases(db: AnyDb, owner: Owner): Promise<Aliases> {
  const rows = await db.select().from(schema.personAliases).where(eq(schema.personAliases.ownerId, owner.id));
  return new Map(rows.map((r) => [r.alias, { userId: r.splitwiseUserId, displayName: r.displayName }]));
}

export async function listAliases(db: AnyDb, owner: Owner) {
  return db.select().from(schema.personAliases).where(eq(schema.personAliases.ownerId, owner.id)).orderBy(asc(schema.personAliases.alias));
}

/** Remember that `name` means this Splitwise person. Saving the same name again replaces what it pointed to. */
export async function saveAlias(db: AnyDb, owner: Owner, input: { name: string; splitwiseUserId: number; displayName: string }) {
  const alias = aliasKey(input.name);
  if (!alias || ["me", "i", "myself", "self"].includes(alias)) throw new UserFacingError("That name can't be an alias.");
  await db
    .insert(schema.personAliases)
    .values({ ownerId: owner.id, alias, splitwiseUserId: input.splitwiseUserId, displayName: input.displayName })
    .onConflictDoUpdate({ target: [schema.personAliases.ownerId, schema.personAliases.alias], set: { splitwiseUserId: input.splitwiseUserId, displayName: input.displayName } });
  await audit(db, owner, "person_alias", alias, "save", null, { splitwiseUserId: input.splitwiseUserId, displayName: input.displayName });
}

export async function deleteAlias(db: AnyDb, owner: Owner, id: string) {
  const res = await db.delete(schema.personAliases).where(and(eq(schema.personAliases.id, id), eq(schema.personAliases.ownerId, owner.id))).returning({ alias: schema.personAliases.alias });
  if (!res.length) throw new NotFoundError("alias", id);
  await audit(db, owner, "person_alias", res[0]!.alias, "delete", null, null);
}
