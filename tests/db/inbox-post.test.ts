// Posting shared Inbox items to Splitwise, against a fake that records every write attempt. Nothing real is called.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ScriptDb } from "@/server/db/connect";
import * as schema from "@/server/db/schema";
import { resolveOwner, type Owner } from "@/server/owner-core";
import { UserFacingError } from "@/server/repos/errors";
import { ingestInbox, loadInbox } from "@/server/repos/inbox";
import { checkPostingItem, postSharedBatch, postSharedItem, previewPosts } from "@/server/repos/inbox-post";
import { seed } from "@/server/seed";
import { FakeSplitwise } from "../server/fake-splitwise";
import { dbAvailable, ENV, openTestDb, OWNER_EMAIL, resetDb } from "./db";

const up = await dbAvailable();
const shared = (over: Record<string, unknown> = {}) => ({
  externalId: "s-1",
  date: "2026-11-16",
  description: "Dinner",
  amount: "20.00",
  category: "Dining Out",
  type: "shared",
  group: "18 Battery Ave",
  paidBy: "me",
  split: [{ person: "me", owes: "8.00" }, { person: "Prathamesh", owes: "12.00" }],
  ...over,
});

describe.skipIf(!up)("posting to Splitwise (DB, fake Splitwise)", () => {
  let db: ScriptDb;
  let close: () => Promise<void>;
  let owner: Owner;
  let sw: FakeSplitwise;
  beforeAll(async () => {
    ({ db, close } = await openTestDb());
  });
  afterAll(async () => close?.());
  beforeEach(async () => {
    await resetDb(db);
    await seed(db, { ownerEmail: OWNER_EMAIL });
    owner = await resolveOwner({ user: { email: OWNER_EMAIL } }, db, ENV);
    sw = new FakeSplitwise();
  });
  const add = async (over: Record<string, unknown> = {}) => {
    await ingestInbox(db, owner, [shared(over)], { dryRun: false });
    return (await loadInbox(db, owner)).pending.find((p) => p.externalId === (over.externalId ?? "s-1"))!;
  };
  const row = async (id: string) => (await db.select().from(schema.inboxItems).where(eq(schema.inboxItems.id, id)))[0]!;

  it("a preview shows exactly who pays and owes what, and writes nothing", async () => {
    const it1 = await add();
    const [p] = await previewPosts(db, owner, sw, [it1.id]);
    expect(p).toMatchObject({ ok: true, problems: [], plan: { groupName: "18 Battery Ave", cost: "20.00" } });
    expect(p!.plan!.lines).toEqual(["You paid USD 20.00", "You owe USD 8.00", "Prathamesh A owes USD 12.00"]);
    expect(sw.created).toHaveLength(0);
    expect((await row(it1.id)).status).toBe("pending");
  });

  it("posts once with the exact payload, records the Splitwise id, and keeps the category you chose", async () => {
    const it1 = await add();
    const { splitwiseExpenseId } = await postSharedItem(db, owner, sw, it1.id);
    expect(sw.created).toHaveLength(1);
    expect(sw.created[0]).toMatchObject({
      cost: "20.00",
      description: "Dinner",
      currencyCode: "USD",
      groupId: 77,
      date: "2026-11-16T12:00:00Z",
      shares: [
        { userId: 1001, paid: "20.00", owed: "8.00" },
        { userId: 2002, paid: "0.00", owed: "12.00" },
      ],
    });
    const saved = await row(it1.id);
    expect(saved).toMatchObject({ status: "approved", splitwiseExpenseId, postError: null });
    const [ov] = await db.select().from(schema.categoryOverrides).where(eq(schema.categoryOverrides.rowKey, `sw:${splitwiseExpenseId}`));
    expect(ov!.categoryId).toBe(saved.categoryId); // the synced row will carry the category chosen in the Inbox
    await expect(postSharedItem(db, owner, sw, it1.id)).rejects.toBeInstanceOf(UserFacingError); // already done
    expect(sw.created).toHaveLength(1);
  });

  it("a double-click or second tab can't post twice", async () => {
    const it1 = await add();
    const results = await Promise.allSettled([postSharedItem(db, owner, sw, it1.id), postSharedItem(db, owner, sw, it1.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(sw.created).toHaveLength(1);
  });

  it("Splitwise refusing it leaves the item ready to try again, with the reason", async () => {
    const it1 = await add();
    sw.createMode = "reject";
    await expect(postSharedItem(db, owner, sw, it1.id)).rejects.toThrow(/Nothing was posted/);
    expect(await row(it1.id)).toMatchObject({ status: "pending", splitwiseExpenseId: null });
    expect((await row(it1.id)).postError).toMatch(/refused/);
    sw.createMode = "ok";
    await postSharedItem(db, owner, sw, it1.id);
    expect((await row(it1.id)).status).toBe("approved");
  });

  it("no clear answer: it stays 'posting', is NOT retried, and checking Splitwise settles it (it was never created)", async () => {
    const it1 = await add();
    sw.createMode = "uncertain-lost";
    await expect(postSharedItem(db, owner, sw, it1.id)).rejects.toThrow(/Check Splitwise/);
    expect((await row(it1.id)).status).toBe("posting");
    sw.createMode = "ok";
    await expect(postSharedItem(db, owner, sw, it1.id)).rejects.toThrow(/Check Splitwise/); // refuses to post blindly
    expect(sw.created).toHaveLength(1);
    expect(await checkPostingItem(db, owner, sw, it1.id)).toEqual({ result: "not_found" });
    expect((await row(it1.id)).status).toBe("pending");
    await postSharedItem(db, owner, sw, it1.id); // now safe
    expect(sw.created).toHaveLength(2);
  });

  it("no clear answer, but it WAS created: checking finds it and links it — no duplicate", async () => {
    const it1 = await add();
    sw.createMode = "uncertain-created";
    await expect(postSharedItem(db, owner, sw, it1.id)).rejects.toThrow(/Check Splitwise/);
    const r = await checkPostingItem(db, owner, sw, it1.id);
    expect(r).toMatchObject({ result: "linked", splitwiseExpenseId: 9000 });
    expect(await row(it1.id)).toMatchObject({ status: "approved", splitwiseExpenseId: 9000 });
    expect(sw.created).toHaveLength(1);
  });

  it("problems are caught before anything is sent: unknown group, unknown person, ambiguous names", async () => {
    const a = await add({ externalId: "g-1", group: "Nope" });
    await expect(postSharedItem(db, owner, sw, a.id)).rejects.toThrow(/No Splitwise group called “Nope”/);
    const b = await add({ externalId: "p-1", split: [{ person: "me", owes: "8.00" }, { person: "Jordan", owes: "12.00" }] });
    await expect(postSharedItem(db, owner, sw, b.id)).rejects.toThrow(/Jordan/);
    expect(sw.created).toHaveLength(0);
    expect((await row(a.id)).status).toBe("pending");
    sw.detailedGroups[0]!.members.push({ id: 5005, firstName: "Prathamesh", lastName: "B" });
    const c = await add({ externalId: "m-1" });
    await expect(postSharedItem(db, owner, sw, c.id)).rejects.toThrow(/more than one person/);
    expect(sw.created).toHaveLength(0);
  });

  it("a non-group expense between friends goes to group 0", async () => {
    const it1 = await add({ externalId: "f-1", group: undefined, split: [{ person: "me", owes: "10.00" }, { person: "Siddh", owes: "10.00" }] });
    await postSharedItem(db, owner, sw, it1.id);
    expect(sw.created[0]).toMatchObject({ groupId: 0, shares: [{ userId: 1001, paid: "20.00", owed: "10.00" }, { userId: 3003, paid: "0.00", owed: "10.00" }] });
  });

  it("an item with no category can't be posted: the synced row would be uncategorised", async () => {
    const it1 = await add({ externalId: "c-1", category: "Nope" });
    await expect(postSharedItem(db, owner, sw, it1.id)).rejects.toThrow(/Choose a category/);
    expect(sw.created).toHaveLength(0);
  });

  it("private items are never posted", async () => {
    await ingestInbox(db, owner, [{ externalId: "pr-1", date: "2026-11-16", description: "Coffee", amount: "4.00", category: "Groceries" }], { dryRun: false });
    const [p] = (await loadInbox(db, owner)).pending;
    await expect(postSharedItem(db, owner, sw, p!.id)).rejects.toThrow(/Only shared/);
    expect(sw.created).toHaveLength(0);
  });

  it("a batch stops at the first one that doesn't go through and leaves the rest untouched", async () => {
    const a = await add({ externalId: "b-1", description: "One" });
    const b = await add({ externalId: "b-2", description: "Two" });
    sw.createMode = "reject";
    const r = await postSharedBatch(db, owner, sw, [a.id, b.id]);
    expect(r).toMatchObject({ posted: 0 });
    expect(r.stoppedBecause).toMatch(/Nothing was posted/);
    expect(sw.created).toHaveLength(1); // only the first was even attempted
    expect((await row(b.id)).status).toBe("pending");
    sw.createMode = "ok";
    expect(await postSharedBatch(db, owner, sw, [a.id, b.id])).toEqual({ posted: 2, stoppedBecause: null });
  });
});
