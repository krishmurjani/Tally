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

/** Saved by you once: "prathamesh adarkar" always means Splitwise user 123. Keys are normalised names. */
export type Aliases = ReadonlyMap<string, { userId: number; displayName: string }>;
export const aliasKey = norm;

export type ResolveResult = { ok: true; person: Person } | { ok: false; problem: string; /** True when nobody matched (so you can say who it is); false when it was ambiguous. */ unmatched: boolean; name: string };

export function resolvePerson(name: string, people: Person[], me: Person, aliases?: Aliases, scope = "this group"): ResolveResult {
  const n = norm(name);
  if (!n) return { ok: false, problem: "A name is empty", unmatched: false, name };
  if (SELF.has(n) || n === full(me) || n === norm(me.firstName)) return { ok: true, person: me };
  const alias = aliases?.get(n);
  if (alias) {
    const hit = people.find((p) => p.id === alias.userId) ?? (alias.userId === me.id ? me : undefined);
    return hit ? { ok: true, person: hit } : { ok: false, problem: `“${name}” is saved as ${alias.displayName}, who isn't in ${scope}`, unmatched: false, name };
  }
  const byFull = people.filter((p) => full(p) === n);
  if (byFull.length === 1) return { ok: true, person: byFull[0]! };
  const byFirst = people.filter((p) => norm(p.firstName) === n);
  if (byFirst.length === 1) return { ok: true, person: byFirst[0]! };
  if (byFull.length > 1 || byFirst.length > 1) return { ok: false, problem: `“${name}” matches more than one person (${(byFull.length > 1 ? byFull : byFirst).map(label).join(", ")})`, unmatched: false, name };
  return { ok: false, problem: `“${name}” isn't in ${scope}`, unmatched: true, name };
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
  /** Splitwise's own category for this expense (null = none found, so Splitwise files it under General). */
  category: { id: number; name: string } | null;
  date: string;
  details: string | null;
}

const two = (minor: number) => (minor / 100).toFixed(2);

export function buildPostPlan(
  item: { amountMinor: number; currency: string; date: string; note: string | null; paidBy: string | null; split: { person: string; owesMinor: number }[] | null },
  target: PostTarget,
  me: Person,
  aliases?: Aliases,
): { ok: true; plan: PostPlan } | { ok: false; problems: string[]; unresolved: string[] } {
  const problems: string[] = [];
  const unresolved: string[] = [];
  if (!item.paidBy) problems.push("Who paid? The item doesn't say");
  if (!item.split || item.split.length === 0) problems.push("Who owes what? The item has no split");
  if (problems.length > 0 || !item.paidBy || !item.split) return { ok: false, problems, unresolved };

  const scope = target.groupId === 0 ? "your friends" : "this group";
  const payer = resolvePerson(item.paidBy, target.people, me, aliases, scope);
  if (!payer.ok) {
    problems.push(`Payer: ${payer.problem}`);
    if (payer.unmatched) unresolved.push(payer.name);
  }
  const owed = new Map<number, { person: Person; minor: number }>();
  for (const s of item.split) {
    const r = resolvePerson(s.person, target.people, me, aliases, scope);
    if (!r.ok) {
      problems.push(r.problem);
      if (r.unmatched && !unresolved.includes(r.name)) unresolved.push(r.name);
      continue;
    }
    if (owed.has(r.person.id)) problems.push(`${label(r.person)} appears twice in the split`);
    else owed.set(r.person.id, { person: r.person, minor: s.owesMinor });
  }
  const owedTotal = [...owed.values()].reduce((a, b) => a + b.minor, 0);
  if (problems.length === 0 && owedTotal !== item.amountMinor) problems.push(`The split adds up to ${two(owedTotal)} but the amount is ${two(item.amountMinor)}`);
  if (problems.length > 0 || !payer.ok) return { ok: false, problems, unresolved };

  const ids = new Set<number>([payer.person.id, ...owed.keys()]);
  const shares: PostShare[] = [...ids].map((userId) => {
    const person = userId === payer.person.id ? payer.person : owed.get(userId)!.person;
    return { userId, name: userId === me.id ? "You" : label(person), paid: two(userId === payer.person.id ? item.amountMinor : 0), owed: two(owed.get(userId)?.minor ?? 0) };
  });
  // You first, then by name, so the confirmation reads the same every time.
  shares.sort((a, b) => (a.name === "You" ? -1 : b.name === "You" ? 1 : a.name.localeCompare(b.name)));
  const payerName = payer.person.id === me.id ? "You" : label(payer.person);
  const lines = [`${payerName} paid ${item.currency} ${two(item.amountMinor)}`, ...shares.filter((s) => s.owed !== "0.00").map((s) => `${s.name} ${s.name === "You" ? "owe" : "owes"} ${item.currency} ${s.owed}`)];
  return { ok: true, plan: { cost: two(item.amountMinor), currency: item.currency, groupId: target.groupId, groupName: target.groupName, shares, lines, category: null, date: `${item.date}T12:00:00Z`, details: item.note } };
}

// ---------------------------------------------------------------------------------------------- categories

export interface SwCategory {
  id: number;
  name: string;
}

/**
 * Which Splitwise category to file an expense under, so it doesn't land in "General".
 * Uses your own mapping (Splitwise name → Tally category) the other way round:
 *   1. a Splitwise category with the same name as the Tally one (Groceries, Gifts, Laundry, Rent…);
 *   2. the mapped Splitwise names for this Tally category, confirmed before suggested, using `prefer` to break ties;
 *   3. nothing (Splitwise then says General).
 * Names that appear under more than one Splitwise heading are skipped: that would be a guess.
 */
export function pickSplitwiseCategory(tallyName: string, mapped: { name: string; confirmed: boolean }[], swCategories: SwCategory[], prefer: readonly string[] = []): SwCategory | null {
  const byName = new Map<string, SwCategory[]>();
  for (const c of swCategories) byName.set(norm(c.name), [...(byName.get(norm(c.name)) ?? []), c]);
  const unique = (name: string): SwCategory | null => {
    const hits = byName.get(norm(name));
    return hits && hits.length === 1 ? hits[0]! : null;
  };
  const exact = unique(tallyName);
  if (exact) return exact;
  const ranked = [...mapped].sort((a, b) => Number(b.confirmed) - Number(a.confirmed) || prefer.indexOf(a.name) - prefer.indexOf(b.name));
  // My preferences first (they exist even where your old mapping used a name Splitwise no longer has), then your mapping.
  const order = [...prefer, ...ranked.map((r) => r.name)];
  for (const name of order) {
    const hit = unique(name);
    if (hit) return hit;
  }
  return null;
}

/** Tie-breaks where one Tally category covers several Splitwise ones. */
export const SPLITWISE_CATEGORY_PREFERENCE: Record<string, readonly string[]> = {
  Transport: ["Bus/train", "Taxi", "Transportation - Other"],
  Travel: ["Plane", "Hotel"],
  "Wi-Fi": ["Internet", "TV/Phone/Internet"],
  Phone: ["TV/Phone/Internet"],
  Personal: ["General"],
  Laundry: ["Laundry", "Cleaning", "Services"],
  "Dining Out": ["Dining out", "Food and drink - Other"],
};
