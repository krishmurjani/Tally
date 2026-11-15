/** Turn one Splitwise API expense into the stored, derived row. Pure. */
import { createHash } from "node:crypto";
import { monthOf, nyDate } from "@/engines/dates";
import { isParsableMinor, parseMinor } from "@/engines/money";
import { evaluateApiExpense } from "@/engines/share";
import type { ShareResult } from "@/engines/types";
import type { ApiExpense } from "./client";

export interface DerivedApiRow {
  splitwiseId: number;
  rowKey: string;
  accountingDate: string;
  month: string;
  description: string;
  costMinor: number;
  currency: string;
  myOwedMinor: number | null;
  myPaidMinor: number | null;
  groupId: number | null;
  groupName: string;
  swCategory: string | null;
  swUpdatedAt: Date | null;
  swDeletedAt: Date | null;
  result: ShareResult;
}

export const apiRowKey = (splitwiseId: number) => `sw:${splitwiseId}`;

/** Deterministic JSON (sorted keys) so the same payload always hashes the same. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

export function hashRaw(raw: unknown): string {
  return createHash("sha256").update(canonicalJson(raw)).digest("hex");
}

function personName(u: ApiExpense["users"][number]): string {
  return [u.user?.first_name, u.user?.last_name].filter(Boolean).join(" ").trim() || `user ${u.user_id}`;
}

export function groupLabel(exp: ApiExpense, myUserId: number, groupNames: Map<number, string>): string {
  if (exp.group_id) return groupNames.get(exp.group_id) ?? `Group ${exp.group_id}`;
  const others = exp.users.filter((u) => u.user_id !== myUserId).map(personName);
  return `Non-group (${others.join(", ") || "just me"})`;
}

const toDate = (s: string | null) => (s ? new Date(s) : null);
const minorOrNull = (s: string | undefined) => (s !== undefined && isParsableMinor(s) ? parseMinor(s) : null);

export function deriveApiRow(
  exp: ApiExpense,
  ctx: { myUserId: number; groupNames: Map<number, string>; usdConfirmation?: { usdMinor: number } | null },
): DerivedApiRow {
  // Decisions are applied at read time (so undo never needs a recompute); USD confirmations here.
  const result = evaluateApiExpense(exp, { myUserId: ctx.myUserId, decision: null, usdConfirmation: ctx.usdConfirmation ?? null });
  const accountingDate = nyDate(exp.date);
  const me = exp.users.find((u) => u.user_id === ctx.myUserId);
  const cost = isParsableMinor(exp.cost) ? parseMinor(exp.cost) : 0;
  if (!isParsableMinor(exp.cost) && result.status === "included") {
    result.status = "review";
    result.reason = "unparseable";
    result.reasonText = "Couldn't read this row — needs review";
    result.shareMinor = 0;
  }
  result.derivation.unshift(`Date ${exp.date} → ${accountingDate} in America/New_York`);
  return {
    splitwiseId: exp.id,
    rowKey: apiRowKey(exp.id),
    accountingDate,
    month: monthOf(accountingDate),
    description: exp.description,
    costMinor: cost,
    currency: exp.currency_code,
    myOwedMinor: minorOrNull(me?.owed_share),
    myPaidMinor: minorOrNull(me?.paid_share),
    groupId: exp.group_id,
    groupName: groupLabel(exp, ctx.myUserId, ctx.groupNames),
    swCategory: exp.category?.name ?? null,
    swUpdatedAt: toDate(exp.updated_at),
    swDeletedAt: toDate(exp.deleted_at),
    result,
  };
}
