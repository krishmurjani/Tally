/**
 * The core personal-share rule for Splitwise API expenses:
 * my personal expense = my owed_share on that expense, subject to the exclusions below,
 * applied in this exact order.
 */
import { formatUSD, isParsableMinor, parseMinor } from "./money";
import { REASON_TEXT, type ReasonCode, type ShareResult } from "./types";

export interface SplitwiseUserShare {
  user_id: number;
  paid_share: string;
  owed_share: string;
  net_balance: string;
}

/** The subset of the Splitwise v3.0 expense object the rules depend on. */
export interface SplitwiseExpense {
  id: number;
  cost: string;
  currency_code: string;
  date: string;
  description: string;
  category: { id: number; name: string } | null;
  group_id: number | null;
  payment: boolean;
  deleted_at: string | null;
  updated_at: string;
  users: SplitwiseUserShare[];
}

export interface ShareContext {
  myUserId: number;
  /** A saved "Not an expense" decision pinned to this expense id. */
  decision?: { reason: string | null } | null;
  /** A confirmed USD amount for a non-USD expense. */
  usdConfirmation?: { usdMinor: number } | null;
}

export function normalizeDescription(s: string): string {
  return s.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Exact phrase "settle all balances", ignoring case and whitespace differences. */
export function isSettleAll(description: string): boolean {
  return normalizeDescription(description) === "settle all balances";
}

function result(
  status: ShareResult["status"],
  reason: ReasonCode,
  derivation: string[],
  shareMinor = 0,
  reasonText: string = REASON_TEXT[reason],
): ShareResult {
  return { status, reason, reasonText, shareMinor: status === "included" ? shareMinor : 0, derivation };
}

export function evaluateApiExpense(exp: SplitwiseExpense, ctx: ShareContext): ShareResult {
  const steps: string[] = [`Splitwise expense #${exp.id}: "${exp.description}", cost ${exp.cost} ${exp.currency_code}`];

  // Only my own expenses are tracked: rows with no share of mine are dropped entirely (not shown).
  const me = exp.users.find((u) => u.user_id === ctx.myUserId);
  if (!me) return result("excluded", "no_share", [...steps, "I'm not a participant → not my expense, not shown"]);

  // Payments I'm part of stay visible as excluded (a payment I receive has a non-zero owed_share).
  if (exp.payment) return result("excluded", "payment", [...steps, "payment = true → excluded"]);

  if (!isParsableMinor(me.owed_share)) {
    return result("review", "unparseable", [...steps, `my owed_share ${JSON.stringify(me.owed_share)} isn't a valid amount`]);
  }
  const owed = parseMinor(me.owed_share);
  steps.push(`my owed_share = ${me.owed_share} (paid_share ${me.paid_share}, net_balance ${me.net_balance})`);
  if (owed === 0) return result("excluded", "no_share", [...steps, "my owed_share is 0 → not my expense, not shown"]);

  if (exp.deleted_at) return result("excluded", "deleted", [...steps, `deleted_at = ${exp.deleted_at} → excluded`]);
  if (isSettleAll(exp.description)) {
    return result("excluded", "settle_all", [...steps, 'description is "settle all balances" → excluded']);
  }
  if (owed < 0) return result("review", "negative_share", [...steps, "owed_share is negative → needs review"]);

  if (ctx.decision) {
    const text = ctx.decision.reason?.trim() || REASON_TEXT.not_an_expense;
    return result("excluded", "not_an_expense", [...steps, `saved "Not an expense" decision: ${text}`], 0, text);
  }

  if (exp.currency_code !== "USD") {
    if (ctx.usdConfirmation) {
      const usd = ctx.usdConfirmation.usdMinor;
      return result(
        "included",
        "usd_confirmed",
        [...steps, `currency ${exp.currency_code}; confirmed USD amount ${formatUSD(usd)} → included`],
        usd,
      );
    }
    return result("review", "non_usd", [...steps, `currency ${exp.currency_code} ≠ USD → needs a confirmed USD amount`]);
  }

  return result("included", "owed_share", [...steps, `included at my owed_share ${formatUSD(owed)}`], owed);
}
