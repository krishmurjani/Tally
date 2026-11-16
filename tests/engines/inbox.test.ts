import { describe, expect, it } from "vitest";
import { blockers, parseInboxItem } from "@/engines/inbox";

const good = { externalId: "2026-11-16-wholefoods-4f2a", date: "2026-11-16", description: "Whole Foods", amount: "84.37", currency: "USD", category: "Groceries", type: "private" };

describe("Inbox item validation", () => {
  it("accepts a clean private item and normalises it", () => {
    const r = parseInboxItem({ ...good, currency: "usd", amount: 84.37 });
    expect(r).toMatchObject({ ok: true, item: { externalId: good.externalId, amountMinor: 8437, currency: "USD", kind: "private", categoryName: "Groceries", split: null } });
  });

  it("defaults: currency USD, type private, category and note empty", () => {
    const r = parseInboxItem({ externalId: "a1", date: "2026-11-16", description: "Coffee", amount: "4.50" });
    expect(r).toMatchObject({ ok: true, item: { currency: "USD", kind: "private", categoryName: null, note: null } });
  });

  it("rejects bad ids, dates, amounts and currencies with a reason each — and never guesses", () => {
    const r = parseInboxItem({ externalId: "has spaces!", date: "2026-02-30", description: "", amount: "12.345", currency: "DOLLARS", type: "maybe" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThanOrEqual(6);
    expect(parseInboxItem({ ...good, amount: "0" }).ok).toBe(false);
    expect(parseInboxItem({ ...good, amount: "-5.00" }).ok).toBe(false);
    expect(parseInboxItem({ ...good, amount: "abc" }).ok).toBe(false);
    expect(parseInboxItem(null).ok).toBe(false);
    expect(parseInboxItem([]).ok).toBe(false);
  });

  it("shared: the split must add up to the total to the cent", () => {
    const shared = { ...good, type: "shared", group: "Apartment", paidBy: "me" };
    const ok = parseInboxItem({ ...shared, amount: "120.00", split: [{ person: "me", owes: "40.00" }, { person: "Alex", owes: "80.00" }] });
    expect(ok).toMatchObject({ ok: true, item: { kind: "shared", groupName: "Apartment", split: [{ person: "me", owesMinor: 4000 }, { person: "Alex", owesMinor: 8000 }] } });
    const off = parseInboxItem({ ...shared, amount: "120.00", split: [{ person: "me", owes: "40.00" }, { person: "Alex", owes: "79.99" }] });
    expect(off.ok).toBe(false);
    if (!off.ok) expect(off.errors.join(" ")).toMatch(/adds up to 119\.99 but the amount is 120\.00/);
  });

  it("a shared item without a split is allowed (it just can't be approved yet)", () => {
    expect(parseInboxItem({ ...good, type: "shared", group: "Apartment" })).toMatchObject({ ok: true, item: { split: null } });
  });

  it("returns the externalId even when the rest is invalid, so the sender can match the failure", () => {
    const r = parseInboxItem({ externalId: "abc-1", date: "nope", description: "x", amount: "1" });
    expect(r).toMatchObject({ ok: false, externalId: "abc-1" });
  });
});

describe("Inbox blockers", () => {
  const ready = { kind: "private" as const, currency: "USD", categoryId: "c1", monthClosed: false };
  it("a private USD item with a category in an open month is ready", () => expect(blockers(ready)).toEqual([]));
  it("lists every reason an item can't be approved", () => {
    expect(blockers({ ...ready, categoryId: null })).toEqual(["Choose a category"]);
    expect(blockers({ ...ready, currency: "INR" })[0]).toMatch(/INR/);
    expect(blockers({ ...ready, monthClosed: true })).toEqual(["That month is closed"]);
    expect(blockers({ ...ready, kind: "shared" })[0]).toMatch(/Splitwise/);
    expect(blockers({ kind: "shared", currency: "INR", categoryId: null, monthClosed: true })).toHaveLength(4);
  });
});
