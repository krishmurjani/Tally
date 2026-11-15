/**
 * "Not an expense" decisions. Decisions are per expense only — there is deliberately NO
 * keyword rule. Pre-seeded decisions are matched once by date + description + cost (+ group),
 * then pinned to the matching expense's key/id. If no unique match exists, they stay pending.
 */
import { normalizeDescription } from "./share";

export interface DecisionSpec {
  id: string;
  date: string;
  description: string;
  costMinor: number;
  /** Group name (or the friend's name for non-group expenses), matched loosely. */
  group?: string | null;
  reason: string;
}

export interface DecisionCandidate {
  key: string;
  date: string;
  description: string;
  costMinor: number;
  group: string | null;
}

export type PinOutcome =
  | { specId: string; state: "pinned"; key: string }
  | { specId: string; state: "pending"; why: "no_match" | "multiple_matches"; candidates: string[] };

/** Lowercase alphanumerics only, so "18 Battery Ave" ≈ "18-battery-ave". */
export function normalizeGroupName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function matchDecision(spec: DecisionSpec, candidates: DecisionCandidate[]): PinOutcome {
  const desc = normalizeDescription(spec.description);
  let matches = candidates.filter(
    (c) => c.date === spec.date && c.costMinor === spec.costMinor && normalizeDescription(c.description) === desc,
  );
  if (spec.group) {
    const g = normalizeGroupName(spec.group);
    matches = matches.filter((c) => c.group !== null && normalizeGroupName(c.group).includes(g));
  }
  if (matches.length === 1) return { specId: spec.id, state: "pinned", key: matches[0]!.key };
  return {
    specId: spec.id,
    state: "pending",
    why: matches.length === 0 ? "no_match" : "multiple_matches",
    candidates: matches.map((m) => m.key),
  };
}

/** Pins every spec; a candidate already claimed by one spec can't be claimed by another. */
export function pinDecisions(specs: DecisionSpec[], candidates: DecisionCandidate[]): PinOutcome[] {
  const outcomes = specs.map((s) => matchDecision(s, candidates));
  const claimed = new Map<string, string[]>();
  for (const o of outcomes) if (o.state === "pinned") claimed.set(o.key, [...(claimed.get(o.key) ?? []), o.specId]);
  return outcomes.map((o) =>
    o.state === "pinned" && claimed.get(o.key)!.length > 1
      ? { specId: o.specId, state: "pending", why: "multiple_matches", candidates: [o.key] }
      : o,
  );
}

export interface ActiveDecision {
  key: string;
  reason: string | null;
  revoked: boolean;
}

/** Map of row key → reason for active (non-revoked) decisions. */
export function activeDecisionMap(decisions: ActiveDecision[]): Map<string, { reason: string | null }> {
  const m = new Map<string, { reason: string | null }>();
  for (const d of decisions) if (!d.revoked) m.set(d.key, { reason: d.reason });
  return m;
}
