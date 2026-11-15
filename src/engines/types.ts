import type { IsoDate } from "./dates";

export type RowStatus = "included" | "excluded" | "review";

export type ReasonCode =
  // excluded
  | "payment"
  | "deleted"
  | "settle_all"
  | "not_an_expense"
  | "no_share"
  // review
  | "non_usd"
  | "negative_share"
  | "ambiguous_csv"
  | "possible_refund"
  | "missing_in_splitwise"
  | "unparseable"
  // included
  | "owed_share"
  | "usd_confirmed"
  | "csv_owed_by_me"
  | "csv_paid_by_me"
  | "csv_pairwise_combined"
  | "csv_self"
  | "manual"
  | "recurring";

export const REASON_TEXT: Record<ReasonCode, string> = {
  payment: "Settlement/payment",
  deleted: "Deleted in Splitwise",
  settle_all: "Settlement",
  not_an_expense: "Not an expense",
  no_share: "Not my expense — not shown",
  non_usd: "Non-USD — needs a confirmed USD amount",
  negative_share: "Negative share — needs review",
  ambiguous_csv: "Ambiguous CSV row — needs review",
  possible_refund: "Possible refund (RETURN) — needs review",
  missing_in_splitwise: "No longer returned by Splitwise — needs review",
  unparseable: "Couldn't read this row — needs review",
  owed_share: "My owed share",
  usd_confirmed: "Confirmed USD amount",
  csv_owed_by_me: "I owed this (|my net|)",
  csv_paid_by_me: "I paid; cost − amount owed to me",
  csv_pairwise_combined: "Non-group expense combined across friends",
  csv_self: "Self group — my amount is my share",
  manual: "Manual expense",
  recurring: "Recurring",
};

/**
 * Only my own expenses are tracked. Rows with no share of mine (not a participant, or I paid
 * but owe nothing) are dropped entirely — never listed, counted, flagged or matched.
 */
export function hasMyShare(r: { result: ShareResult }): boolean {
  return r.result.reason !== "no_share";
}

export type RowSource = "splitwise" | "csv" | "manual" | "recurring";

/** The normalized result of applying share rules to one source record. */
export interface ShareResult {
  status: RowStatus;
  reason: ReasonCode;
  /** Reason text shown in the UI; for "not_an_expense" this is the saved reason. */
  reasonText: string;
  /** My share in USD minor units. 0 unless status === "included". */
  shareMinor: number;
  /** Human-readable steps explaining how the share was derived from raw data. */
  derivation: string[];
}

/** A row on the month's ledger, independent of where it came from. */
export interface LedgerRow {
  key: string;
  source: RowSource;
  date: IsoDate;
  description: string;
  /** Category name as given by the source (Splitwise category), if any. */
  sourceCategory: string | null;
  group: string | null;
  costMinor: number;
  currency: string;
  result: ShareResult;
}
