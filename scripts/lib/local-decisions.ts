/**
 * Krish-confirmed per-expense decisions that reference real rows. They live in
 * fixtures/private/confirmed-decisions.json (gitignored) so no private data enters the repo.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { DecisionSpec } from "../../src/engines/decisions";
import { PRESEEDED_DECISION_SPECS } from "../../src/engines/pipeline";
import { FIXTURE_DIR } from "./load-exports";

const FileSchema = z.object({
  version: z.literal(1),
  decisions: z.array(
    z.object({
      id: z.string().min(1),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      description: z.string().min(1),
      costMinor: z.number().int(),
      group: z.string().nullable().optional(),
      reason: z.string(),
    }),
  ),
});

export const LOCAL_DECISIONS_FILE = join(FIXTURE_DIR, "confirmed-decisions.json");

export function loadLocalDecisions(file = LOCAL_DECISIONS_FILE): DecisionSpec[] {
  if (!existsSync(file)) return [];
  return FileSchema.parse(JSON.parse(readFileSync(file, "utf8"))).decisions;
}

/** Spec pre-seeds plus the local confirmed decisions (ids must be unique). */
export function allDecisionSpecs(): DecisionSpec[] {
  const all = [...PRESEEDED_DECISION_SPECS, ...loadLocalDecisions()];
  const ids = all.map((d) => d.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new Error(`Duplicate decision id ${dup}`);
  return all;
}
