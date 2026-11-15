/**
 * Personal-share rules for Splitwise CSV exports (net-balance interpretation).
 *
 * - Negative my-net → share = |net| (I owed it).
 * - Positive my-net → share = cost − net (I paid; others owe me `net`).
 * - My share 0 (net 0, or net == cost: I paid but owe nothing) → not my expense, dropped entirely.
 * - Payment category / settle-all → excluded (still shown).
 * - Self group (me + "Card"): my amount is already my share → |my net|. RETURN… → review.
 * - Non-group expenses appear once per friend in pairwise exports: combine the owed-to-me
 *   portions once, share = cost − Σ portions.
 * - Anything ambiguous → Needs review. Never guessed.
 */
import { compareMonths, monthOf, type MonthKey } from "../dates";
import { formatUSD, minorToDecimalString } from "../money";
import { isSettleAll, normalizeDescription } from "../share";
import { hasMyShare, REASON_TEXT, type LedgerRow, type ReasonCode, type RowStatus, type ShareResult } from "../types";
import type { CsvTransaction, ParsedExport } from "./parse";

export interface ExportSelection {
  used: ParsedExport[];
  /** Older exports of the same source, superseded by a newer one (never summed). */
  superseded: { export: ParsedExport; supersededBy: ParsedExport }[];
}

/** Per source, the newest export wins (exports cover all time, so the newest is a superset). */
export function selectLatestExports(exports: ParsedExport[]): ExportSelection {
  const bySource = new Map<string, ParsedExport[]>();
  for (const e of exports) bySource.set(e.source, [...(bySource.get(e.source) ?? []), e]);
  const used: ParsedExport[] = [];
  const superseded: ExportSelection["superseded"] = [];
  for (const [source, list] of bySource) {
    const dated = list.filter((e) => e.exportDate);
    if (dated.length !== list.length && list.length > 1) {
      throw new Error(`Multiple exports for "${source}" and at least one has no export date in its filename`);
    }
    const sorted = [...list].sort((a, b) => (a.exportDate! < b.exportDate! ? 1 : -1));
    if (sorted.length > 1 && sorted[0]!.exportDate === sorted[1]!.exportDate) {
      throw new Error(`Two exports for "${source}" share the export date ${sorted[0]!.exportDate}`);
    }
    used.push(sorted[0]!);
    for (const old of sorted.slice(1)) superseded.push({ export: old, supersededBy: sorted[0]! });
  }
  return { used, superseded };
}

function mk(
  status: RowStatus,
  reason: ReasonCode,
  derivation: string[],
  shareMinor = 0,
): ShareResult {
  return { status, reason, reasonText: REASON_TEXT[reason], shareMinor: status === "included" ? shareMinor : 0, derivation };
}

const usd = (m: number) => formatUSD(m);

function describe(t: CsvTransaction, e: ParsedExport): string {
  return `${e.fileName} line ${t.line}: ${t.date} "${t.description}" [${t.category}] cost ${t.costRaw} ${t.currency}`;
}

/** Rules shared by every export kind, checked before the net-balance arithmetic. */
function preRules(t: CsvTransaction, steps: string[]): ShareResult | null {
  if (t.category === "Payment") return mk("excluded", "payment", [...steps, "category Payment → excluded"]);
  if (isSettleAll(t.description)) return mk("excluded", "settle_all", [...steps, '"settle all balances" → excluded']);
  if (t.currency !== "USD") return mk("review", "non_usd", [...steps, `currency ${t.currency} ≠ USD → needs review`]);
  return null;
}

/** Group exports (not Self): one row per expense, nets already cover everyone. */
export function evaluateGroupRow(t: CsvTransaction, e: ParsedExport): ShareResult {
  const steps = [describe(t, e), `my net balance = ${minorToDecimalString(t.myNetMinor)}`];
  if (t.myNetMinor === 0) return mk("excluded", "no_share", [...steps, "net 0 → not my expense, not shown"]);
  const pre = preRules(t, steps);
  if (pre) return pre;
  const net = t.myNetMinor;
  if (net < 0) return mk("included", "csv_owed_by_me", [...steps, `net negative → share = |net| = ${usd(-net)}`], -net);
  if (t.costMinor <= 0) return mk("review", "ambiguous_csv", [...steps, "positive net on a non-positive cost → needs review"]);
  if (net === t.costMinor) return mk("excluded", "no_share", [...steps, "net == cost → I paid but owe nothing → not my expense, not shown"]);
  if (net > t.costMinor) return mk("review", "ambiguous_csv", [...steps, "net > cost → needs review"]);
  const share = t.costMinor - net;
  return mk("included", "csv_paid_by_me", [...steps, `net positive → share = cost − net = ${usd(t.costMinor)} − ${usd(net)} = ${usd(share)}`], share);
}

/** Self group: my amount is already my share. */
export function evaluateSelfRow(t: CsvTransaction, e: ParsedExport): ShareResult {
  const steps = [describe(t, e), `my net balance = ${minorToDecimalString(t.myNetMinor)}`, "Self group: my amount is my share"];
  if (t.myNetMinor === 0) return mk("excluded", "no_share", [...steps, "net 0 → not my expense, not shown"]);
  const pre = preRules(t, steps);
  if (pre) return pre;
  if (/^\s*return\b/i.test(t.description)) {
    return mk("review", "possible_refund", [...steps, 'description starts with "RETURN" → possible refund, needs review']);
  }
  const net = t.myNetMinor;
  if (net > 0) return mk("review", "ambiguous_csv", [...steps, "positive net in Self group is unexpected → needs review"]);
  return mk("included", "csv_self", [...steps, `share = |net| = ${usd(-net)}`], -net);
}

interface PairOccurrence {
  export: ParsedExport;
  txn: CsvTransaction;
}

export function pairwiseKey(t: CsvTransaction): string {
  return [t.date, normalizeDescription(t.description), t.costMinor, t.category, t.currency].join("|");
}

/** Combine one non-group expense across all pairwise exports it appears in. */
export function evaluatePairwiseGroup(occ: PairOccurrence[]): ShareResult {
  const first = occ[0]!.txn;
  const steps = occ.map(
    (o) => `${describe(o.txn, o.export)} — with ${o.export.others.join(", ")}: my net ${minorToDecimalString(o.txn.myNetMinor)}`,
  );
  if (occ.every((o) => o.txn.myNetMinor === 0)) return mk("excluded", "no_share", [...steps, "net 0 everywhere → not my expense, not shown"]);
  const pre = preRules(first, steps);
  if (pre) return pre;

  const perFile = new Map<string, number>();
  for (const o of occ) perFile.set(o.export.fileName, (perFile.get(o.export.fileName) ?? 0) + 1);
  if ([...perFile.values()].some((n) => n > 1)) {
    return mk("review", "ambiguous_csv", [...steps, "identical rows appear more than once in the same export — can't tell which match → needs review"]);
  }

  const nets = occ.map((o) => o.txn.myNetMinor).filter((n) => n !== 0);
  const pos = nets.filter((n) => n > 0);
  const neg = nets.filter((n) => n < 0);
  if (pos.length && neg.length) {
    return mk("review", "ambiguous_csv", [...steps, "I'm owed by one friend and owe another on the same expense → needs review"]);
  }
  if (neg.length) {
    if (neg.length > 1) {
      return mk("review", "ambiguous_csv", [...steps, "I owe more than one friend on the same expense (multiple payers?) → needs review"]);
    }
    const share = -neg[0]!;
    return mk("included", "csv_owed_by_me", [...steps, `net negative → share = |net| = ${usd(share)}`], share);
  }
  const owedToMe = pos.reduce((a, b) => a + b, 0);
  const share = first.costMinor - owedToMe;
  const calc = `share = cost − Σ owed-to-me = ${usd(first.costMinor)} − ${usd(owedToMe)} = ${usd(share)}`;
  if (first.costMinor <= 0 || share < 0) return mk("review", "ambiguous_csv", [...steps, `${calc} → negative, needs review`]);
  if (share === 0) return mk("excluded", "no_share", [...steps, `${calc} → I paid but owe nothing → not my expense, not shown`]);
  const reason: ReasonCode = pos.length > 1 ? "csv_pairwise_combined" : "csv_paid_by_me";
  return mk("included", reason, [...steps, calc], share);
}

export interface CsvMonthResult {
  month: MonthKey;
  rows: LedgerRow[];
  selection: ExportSelection;
  /** Unparseable lines from the used exports that fall in (or can't be placed outside) this month. */
  problems: { fileName: string; line: number; message: string }[];
  /** Rows in the month with no share of mine. Dropped entirely; count kept for audit only. */
  noShareCount: number;
  /** Used exports that end before the month does: "mtd" = ends inside the month, "before" = has none of it. */
  partial: { fileName: string; lastDate: string; coverage: "mtd" | "before" }[];
}

function groupLabel(e: ParsedExport): string {
  if (e.kind === "pairwise") return `Non-group (${e.others.join(", ")})`;
  if (e.kind === "self") return "Self";
  return e.source;
}

/** Derive the month's ledger rows from a set of exports. */
export function deriveCsvMonth(exports: ParsedExport[], month: MonthKey): CsvMonthResult {
  const selection = selectLatestExports(exports);
  const rows: LedgerRow[] = [];
  const pairs = new Map<string, PairOccurrence[]>();
  const problems: CsvMonthResult["problems"] = [];
  const partial: CsvMonthResult["partial"] = [];

  for (const e of selection.used) {
    for (const p of e.problems) {
      const d = p.cells[0]?.trim() ?? "";
      const placed = /^\d{4}-\d{2}-\d{2}$/.test(d);
      if (!placed || monthOf(d) === month) problems.push({ fileName: e.fileName, line: p.line, message: p.message });
    }
    const footerDate = e.footer?.date ?? e.exportDate ?? "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(footerDate) && compareMonths(monthOf(footerDate), month) <= 0) {
      // Export was produced during (or before) this month: it can't contain the whole month.
      partial.push({
        fileName: e.fileName,
        lastDate: footerDate,
        coverage: monthOf(footerDate) === month ? "mtd" : "before",
      });
    }

    const seen = new Map<string, number>();
    for (const t of e.transactions) {
      if (monthOf(t.date) !== month) continue;
      if (e.kind === "pairwise") {
        const k = pairwiseKey(t);
        pairs.set(k, [...(pairs.get(k) ?? []), { export: e, txn: t }]);
        continue;
      }
      const base = `csv:${e.source}:${t.date}:${normalizeDescription(t.description)}:${t.costMinor}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      rows.push({
        key: n === 1 ? base : `${base}#${n}`,
        source: "csv",
        date: t.date,
        description: t.description,
        sourceCategory: t.category,
        group: groupLabel(e),
        costMinor: t.costMinor,
        currency: t.currency,
        result: e.kind === "self" ? evaluateSelfRow(t, e) : evaluateGroupRow(t, e),
      });
    }
  }

  for (const [k, occ] of pairs) {
    const t = occ[0]!.txn;
    const friends = [...new Set(occ.flatMap((o) => o.export.others))];
    rows.push({
      key: `csv:pairwise:${k}`,
      source: "csv",
      date: t.date,
      description: t.description,
      sourceCategory: t.category,
      group: `Non-group (${friends.join(", ")})`,
      costMinor: t.costMinor,
      currency: t.currency,
      result: evaluatePairwiseGroup(occ),
    });
  }

  const mine = rows.filter(hasMyShare);
  mine.sort((a, b) => (a.date === b.date ? a.key.localeCompare(b.key) : a.date < b.date ? -1 : 1));
  return { month, rows: mine, selection, problems, partial, noShareCount: rows.length - mine.length };
}
