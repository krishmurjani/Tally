/**
 * Turning an Inbox item into one Splitwise expense: find the group, find each person, build the exact shares.
 * Pure — no network. Anything ambiguous is a problem to show, never a guess: this writes to shared data.
 */
export interface Person {
  id: number;
  firstName: string;
  lastName: string;
}
export interface Group {
  id: number;
  name: string;
  members: Person[];
}
export interface PostTarget {
  /** 0 = a non-group expense between friends. */
  groupId: number;
  groupName: string | null;
  people: Person[];
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const full = (p: Person) => norm(`${p.firstName} ${p.lastName}`);
const label = (p: Person) => `${p.firstName} ${p.lastName}`.trim() || `user ${p.id}`;
const SELF = new Set(["me", "i", "myself", "self"]);

export function resolveTarget(groupName: string | null, groups: Group[], friends: Person[], me: Person): { ok: true; target: PostTarget } | { ok: false; problems: string[] } {
  if (!groupName) {
    const others = friends.filter((f) => f.id !== me.id);
    return { ok: true, target: { groupId: 0, groupName: null, people: [me, ...others] } };
  }
  const hits = groups.filter((g) => norm(g.name) === norm(groupName));
  if (hits.length === 0) {
    const names = groups.map((g) => g.name).join(", ");
    return { ok: false, problems: [`No Splitwise group called “${groupName}”.${names ? ` Your groups: ${names}.` : ""}`] };
  }
  if (hits.length > 1) return { ok: false, problems: [`More than one Splitwise group is called “${groupName}”.`] };
  const g = hits[0]!;
  const people = g.members.some((m) => m.id === me.id) ? g.members : [me, ...g.members];
  return { ok: true, target: { groupId: g.id, groupName: g.name, people } };
}

export function resolvePerson(name: string, people: Person[], me: Person): { ok: true; person: Person } | { ok: false; problem: string } {
  const n = norm(name);
  if (!n) return { ok: false, problem: "A name is empty" };
  if (SELF.has(n) || n === full(me) || n === norm(me.firstName)) return { ok: true, person: me };
  const byFull = people.filter((p) => full(p) === n);
  if (byFull.length === 1) return { ok: true, person: byFull[0]! };
  const byFirst = people.filter((p) => norm(p.firstName) === n);
  if (byFirst.length === 1) return { ok: true, person: byFirst[0]! };
  if (byFull.length > 1 || byFirst.length > 1) return { ok: false, problem: `“${name}” matches more than one person (${(byFull.length > 1 ? byFull : byFirst).map(label).join(", ")})` };
  return { ok: false, problem: `“${name}” isn't in ${people.length ? "this group" : "your friends"}` };
}

export interface PostShare {
  userId: number;
  name: string;
  paid: string;
  owed: string;
}
export interface PostPlan {
  cost: string;
  currency: string;
  groupId: number;
  groupName: string | null;
  shares: PostShare[];
  /** Plain-language lines for the confirmation: who paid, who owes what. */
  lines: string[];
  date: string;
  details: string | null;
}

const two = (minor: number) => (minor / 100).toFixed(2);

export function buildPostPlan(
  item: { amountMinor: number; currency: string; date: string; note: string | null; paidBy: string | null; split: { person: string; owesMinor: number }[] | null },
  target: PostTarget,
  me: Person,
): { ok: true; plan: PostPlan } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  if (!item.paidBy) problems.push("Who paid? The item doesn't say");
  if (!item.split || item.split.length === 0) problems.push("Who owes what? The item has no split");
  if (problems.length > 0 || !item.paidBy || !item.split) return { ok: false, problems };

  const payer = resolvePerson(item.paidBy, target.people, me);
  if (!payer.ok) problems.push(`Payer: ${payer.problem}`);
  const owed = new Map<number, { person: Person; minor: number }>();
  for (const s of item.split) {
    const r = resolvePerson(s.person, target.people, me);
    if (!r.ok) {
      problems.push(r.problem);
      continue;
    }
    if (owed.has(r.person.id)) problems.push(`${label(r.person)} appears twice in the split`);
    else owed.set(r.person.id, { person: r.person, minor: s.owesMinor });
  }
  const owedTotal = [...owed.values()].reduce((a, b) => a + b.minor, 0);
  if (problems.length === 0 && owedTotal !== item.amountMinor) problems.push(`The split adds up to ${two(owedTotal)} but the amount is ${two(item.amountMinor)}`);
  if (problems.length > 0 || !payer.ok) return { ok: false, problems };

  const ids = new Set<number>([payer.person.id, ...owed.keys()]);
  const shares: PostShare[] = [...ids].map((userId) => {
    const person = userId === payer.person.id ? payer.person : owed.get(userId)!.person;
    return { userId, name: userId === me.id ? "You" : label(person), paid: two(userId === payer.person.id ? item.amountMinor : 0), owed: two(owed.get(userId)?.minor ?? 0) };
  });
  // You first, then by name, so the confirmation reads the same every time.
  shares.sort((a, b) => (a.name === "You" ? -1 : b.name === "You" ? 1 : a.name.localeCompare(b.name)));
  const payerName = payer.person.id === me.id ? "You" : label(payer.person);
  const lines = [`${payerName} paid ${item.currency} ${two(item.amountMinor)}`, ...shares.filter((s) => s.owed !== "0.00").map((s) => `${s.name} ${s.name === "You" ? "owe" : "owes"} ${item.currency} ${s.owed}`)];
  return { ok: true, plan: { cost: two(item.amountMinor), currency: item.currency, groupId: target.groupId, groupName: target.groupName, shares, lines, date: `${item.date}T12:00:00Z`, details: item.note } };
}
