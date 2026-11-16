// The Inbox end to end through the database: tokens, ingest, duplicates, dry runs, approval.
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ScriptDb } from "@/server/db/connect";
import * as schema from "@/server/db/schema";
import { resolveOwner, type Owner } from "@/server/owner-core";
import { UserFacingError } from "@/server/repos/errors";
import { approveInboxItem, approveReadyInbox, createApiToken, ingestInbox, listApiTokens, loadInbox, ownerFromBearer, pendingInboxCount, rejectInboxItem, revokeApiToken, setInboxCategory } from "@/server/repos/inbox";
import { seed } from "@/server/seed";
import { dbAvailable, ENV, openTestDb, OWNER_EMAIL, resetDb } from "./db";

const up = await dbAvailable();
const item = (over: Record<string, unknown> = {}) => ({ externalId: "e-1", date: "2026-11-16", description: "Whole Foods", amount: "84.37", currency: "USD", category: "Groceries", type: "private", ...over });

describe.skipIf(!up)("Inbox (DB)", () => {
  let db: ScriptDb;
  let close: () => Promise<void>;
  let owner: Owner;
  beforeAll(async () => {
    ({ db, close } = await openTestDb());
  });
  afterAll(async () => close?.());
  beforeEach(async () => {
    await resetDb(db);
    await seed(db, { ownerEmail: OWNER_EMAIL });
    owner = await resolveOwner({ user: { email: OWNER_EMAIL } }, db, ENV);
  });

  it("tokens: shown once, stored only as a hash, revocable, and a wrong one is just null", async () => {
    const t = await createApiToken(db, owner, "Instinct");
    expect(t.token).toMatch(/^tly_[A-Za-z0-9_-]{40,}$/);
    const [row] = await db.select().from(schema.apiTokens);
    expect(JSON.stringify(row)).not.toContain(t.token); // plaintext is never stored
    expect(row!.tokenHash).toMatch(/^[0-9a-f]{64}$/);

    expect((await ownerFromBearer(db, `Bearer ${t.token}`))?.id).toBe(owner.id);
    expect((await listApiTokens(db, owner))[0]!.lastUsedAt).not.toBeNull();
    expect(await ownerFromBearer(db, `Bearer ${t.token}x`)).toBeNull();
    expect(await ownerFromBearer(db, t.token)).toBeNull(); // no "Bearer"
    expect(await ownerFromBearer(db, null)).toBeNull();

    await revokeApiToken(db, owner, t.id);
    expect(await ownerFromBearer(db, `Bearer ${t.token}`)).toBeNull();
  });

  it("creates drafts, matching categories case-insensitively, and nothing counts yet", async () => {
    const res = await ingestInbox(db, owner, [item(), item({ externalId: "e-2", category: "groceries", description: "Trader Joe's" })], { dryRun: false });
    expect(res.map((r) => r.status)).toEqual(["created", "created"]);
    expect(res.every((r) => (r.blockers ?? []).length === 0)).toBe(true);
    expect(await pendingInboxCount(db, owner)).toBe(2);
    expect(await db.select().from(schema.manualExpenses)).toHaveLength(0);
  });

  it("resending the same externalId is ignored; a changed resend is flagged as different", async () => {
    await ingestInbox(db, owner, [item()], { dryRun: false });
    const again = await ingestInbox(db, owner, [item()], { dryRun: false });
    expect(again[0]).toMatchObject({ status: "duplicate_ignored", existing: { status: "pending", differs: false } });
    const changed = await ingestInbox(db, owner, [item({ amount: "90.00" })], { dryRun: false });
    expect(changed[0]).toMatchObject({ status: "duplicate_ignored", existing: { differs: true } });
    expect(await pendingInboxCount(db, owner)).toBe(1);
    const twice = await ingestInbox(db, owner, [item({ externalId: "e-9" }), item({ externalId: "e-9" })], { dryRun: false });
    expect(twice.map((r) => r.status)).toEqual(["created", "duplicate_ignored"]);
  });

  it("dryRun reports what would happen and writes nothing", async () => {
    await ingestInbox(db, owner, [item()], { dryRun: false });
    const res = await ingestInbox(db, owner, [item(), item({ externalId: "e-2" }), item({ externalId: "e-3", amount: "x" })], { dryRun: true });
    expect(res.map((r) => r.status)).toEqual(["would_ignore_duplicate", "would_create", "invalid"]);
    expect(await pendingInboxCount(db, owner)).toBe(1);
  });

  it("invalid items are reported with reasons and not stored; the rest of the batch still goes in", async () => {
    const res = await ingestInbox(db, owner, [item({ externalId: "bad-1", amount: "12.345" }), item({ externalId: "good-1" })], { dryRun: false });
    expect(res[0]).toMatchObject({ externalId: "bad-1", status: "invalid" });
    expect(res[0]!.errors!.length).toBeGreaterThan(0);
    expect(res[1]!.status).toBe("created");
    expect(await pendingInboxCount(db, owner)).toBe(1);
  });

  it("an unknown category is never guessed: it stays a draft that needs choosing", async () => {
    const [r] = await ingestInbox(db, owner, [item({ category: "Grocries" })], { dryRun: false });
    expect(r!.blockers).toEqual(["Choose a category"]);
    expect(r!.notes![0]).toMatch(/Unknown category "Grocries"/);
  });

  it("approving makes a private expense in Tally, once, with the category you chose", async () => {
    await ingestInbox(db, owner, [item({ category: "Grocries" })], { dryRun: false });
    const { pending, categories } = await loadInbox(db, owner);
    const row = pending[0]!;
    await expect(approveInboxItem(db, owner, row.id)).rejects.toBeInstanceOf(UserFacingError); // no category yet
    const groceries = categories.find((c) => c.name === "Groceries")!;
    await setInboxCategory(db, owner, { id: row.id, categoryId: groceries.id });
    const { manualExpenseId } = await approveInboxItem(db, owner, row.id);
    const [exp] = await db.select().from(schema.manualExpenses).where(eq(schema.manualExpenses.id, manualExpenseId));
    expect(exp).toMatchObject({ description: "Whole Foods", amountMinor: 8437, month: "2026-11", currency: "USD", categoryId: groceries.id });
    await expect(approveInboxItem(db, owner, row.id)).rejects.toThrow(/already approved/);
    expect(await db.select().from(schema.manualExpenses)).toHaveLength(1);
    expect(await pendingInboxCount(db, owner)).toBe(0);
  });

  it("shared and non-USD drafts can't be approved into Tally", async () => {
    await ingestInbox(
      db,
      owner,
      [
        item({ externalId: "s-1", type: "shared", group: "Apartment", amount: "120.00", split: [{ person: "me", owes: "40.00" }, { person: "Alex", owes: "80.00" }] }),
        item({ externalId: "i-1", currency: "INR", amount: "500.00" }),
      ],
      { dryRun: false },
    );
    const { pending } = await loadInbox(db, owner);
    for (const r of pending) await expect(approveInboxItem(db, owner, r.id)).rejects.toBeInstanceOf(UserFacingError);
    expect(await db.select().from(schema.manualExpenses)).toHaveLength(0);
  });

  it("approve-all takes only what's ready; reject removes from the queue", async () => {
    await ingestInbox(db, owner, [item({ externalId: "r-1" }), item({ externalId: "r-2" }), item({ externalId: "n-1", category: "Nope" }), item({ externalId: "x-1" })], { dryRun: false });
    const { pending } = await loadInbox(db, owner);
    const toReject = pending.find((p) => p.externalId === "x-1")!;
    await rejectInboxItem(db, owner, toReject.id);
    expect(await approveReadyInbox(db, owner)).toEqual({ approved: 2, left: 1 });
    const manual = await db.select().from(schema.manualExpenses);
    expect(manual).toHaveLength(2);
    const [n1] = await db.select().from(schema.inboxItems).where(and(eq(schema.inboxItems.ownerId, owner.id), eq(schema.inboxItems.externalId, "n-1")));
    expect(n1!.status).toBe("pending");
  });

  it("limits: empty and oversized batches are refused", async () => {
    await expect(ingestInbox(db, owner, [], { dryRun: false })).rejects.toBeInstanceOf(UserFacingError);
    await expect(ingestInbox(db, owner, Array.from({ length: 101 }, (_, i) => item({ externalId: `n-${i}` })), { dryRun: false })).rejects.toBeInstanceOf(UserFacingError);
  });
});
