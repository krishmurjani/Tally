import { describe, expect, it } from "vitest";
import { buildPostPlan, resolvePerson, resolveTarget, type Group, type Person } from "@/engines/splitwise-post";

const me: Person = { id: 1, firstName: "Krish", lastName: "Murjani" };
const alex: Person = { id: 2, firstName: "Alex", lastName: "Stone" };
const alexB: Person = { id: 3, firstName: "Alex", lastName: "Brown" };
const sam: Person = { id: 4, firstName: "Sam", lastName: "Lee" };
const apartment: Group = { id: 77, name: "Apartment", members: [me, alex, sam] };
const twoAlex: Group = { id: 88, name: "Trip", members: [me, alex, alexB] };
const item = (over: Record<string, unknown> = {}) => ({ amountMinor: 12000, currency: "USD", date: "2026-11-16", note: null, paidBy: "me", split: [{ person: "me", owesMinor: 4000 }, { person: "Alex", owesMinor: 8000 }], ...over });

describe("finding the group", () => {
  it("matches by name, ignoring case and spacing", () => {
    expect(resolveTarget(" apartment ", [apartment], [], me)).toMatchObject({ ok: true, target: { groupId: 77, groupName: "Apartment" } });
  });
  it("no group means a non-group expense between friends (group 0)", () => {
    expect(resolveTarget(null, [apartment], [alex, sam], me)).toMatchObject({ ok: true, target: { groupId: 0, groupName: null } });
  });
  it("an unknown group is a problem that names the real ones — never a guess", () => {
    const r = resolveTarget("Aparment", [apartment], [], me);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems[0]).toMatch(/No Splitwise group called “Aparment”.*Apartment/);
  });
});

describe("finding people", () => {
  it('"me" and my own name are me', () => {
    for (const n of ["me", "Me", "myself", "Krish", "krish murjani"]) expect(resolvePerson(n, apartment.members, me)).toMatchObject({ ok: true, person: { id: 1 } });
  });
  it("first name works when it's unique; full name settles it when it isn't", () => {
    expect(resolvePerson("sam", apartment.members, me)).toMatchObject({ ok: true, person: { id: 4 } });
    expect(resolvePerson("Alex", twoAlex.members, me)).toMatchObject({ ok: false });
    expect(resolvePerson("alex brown", twoAlex.members, me)).toMatchObject({ ok: true, person: { id: 3 } });
  });
  it("someone who isn't in the group is a problem", () => {
    expect(resolvePerson("Jordan", apartment.members, me)).toMatchObject({ ok: false });
  });
});

describe("building the expense", () => {
  const target = { groupId: 77, groupName: "Apartment", people: apartment.members };
  it("payer pays the whole cost; owed shares come from the split; amounts to the cent", () => {
    const r = buildPostPlan(item(), target, me);
    expect(r).toMatchObject({ ok: true, plan: { cost: "120.00", currency: "USD", groupId: 77, date: "2026-11-16T12:00:00Z" } });
    if (!r.ok) return;
    expect(r.plan.shares).toEqual([
      { userId: 1, name: "You", paid: "120.00", owed: "40.00" },
      { userId: 2, name: "Alex Stone", paid: "0.00", owed: "80.00" },
    ]);
    expect(r.plan.lines).toEqual(["You paid USD 120.00", "You owe USD 40.00", "Alex Stone owes USD 80.00"]);
  });

  it("someone else paid: you owe your part, they paid it all", () => {
    const r = buildPostPlan(item({ paidBy: "Sam", split: [{ person: "me", owesMinor: 6000 }, { person: "Sam", owesMinor: 6000 }] }), target, me);
    expect(r.ok && r.plan.shares.find((s) => s.userId === 4)).toMatchObject({ paid: "120.00", owed: "60.00" });
    expect(r.ok && r.plan.shares.find((s) => s.userId === 1)).toMatchObject({ paid: "0.00", owed: "60.00" });
  });

  it("a payer who owes nothing is still listed (paid 120.00, owed 0.00)", () => {
    const r = buildPostPlan(item({ split: [{ person: "Alex", owesMinor: 12000 }] }), target, me);
    expect(r.ok && r.plan.shares.find((s) => s.userId === 1)).toMatchObject({ paid: "120.00", owed: "0.00" });
  });

  it("uneven to the cent: 33.34 + 33.33 + 33.33", () => {
    const r = buildPostPlan(item({ amountMinor: 10000, split: [{ person: "me", owesMinor: 3334 }, { person: "Alex", owesMinor: 3333 }, { person: "Sam", owesMinor: 3333 }] }), target, me);
    expect(r.ok && r.plan.shares.map((s) => s.owed)).toEqual(["33.34", "33.33", "33.33"]);
  });

  it("refuses rather than guessing: no payer, no split, wrong total, unknown or repeated person", () => {
    expect(buildPostPlan(item({ paidBy: null }), target, me)).toMatchObject({ ok: false });
    expect(buildPostPlan(item({ split: null }), target, me)).toMatchObject({ ok: false });
    expect(buildPostPlan(item({ split: [{ person: "me", owesMinor: 4000 }, { person: "Alex", owesMinor: 7999 }] }), target, me)).toMatchObject({ ok: false });
    expect(buildPostPlan(item({ split: [{ person: "me", owesMinor: 4000 }, { person: "Jordan", owesMinor: 8000 }] }), target, me)).toMatchObject({ ok: false });
    expect(buildPostPlan(item({ split: [{ person: "Alex", owesMinor: 6000 }, { person: "alex", owesMinor: 6000 }] }), target, me)).toMatchObject({ ok: false });
  });

  it("carries the note as details and keeps the currency", () => {
    const r = buildPostPlan(item({ currency: "INR", note: "dad tab" }), target, me);
    expect(r).toMatchObject({ ok: true, plan: { currency: "INR", details: "dad tab" } });
  });
});
