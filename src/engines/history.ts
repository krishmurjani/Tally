/**
 * Historical monthly category summaries from Krish's old workbooks — no fake transactions.
 * CSV format: header `month,category,amount`; month YYYY-MM; category must already exist;
 * amount is exact dollars (never rounded). Anything off is an error, never guessed.
 */
import { tokenizeCsv } from "./csv/parse";
import { isMonthKey, type MonthKey } from "./dates";
import { isParsableMinor, parseMinor } from "./money";

export interface HistoryRow {
  line: number;
  month: MonthKey;
  category: string;
  amountMinor: number;
}

export interface HistoryParse {
  rows: HistoryRow[];
  errors: { line: number; message: string }[];
  byMonth: Map<MonthKey, { totalMinor: number; byCategory: Map<string, number> }>;
}

/** Known monthly totals from the build spec, used to validate an import. */
export const KNOWN_HISTORY_TOTALS: Record<MonthKey, number> = {
  "2025-05": 145493,
  "2025-06": 133179,
  "2025-07": 193101,
  "2025-08": 148144,
  "2025-09": 161190,
  "2025-10": 159866,
  "2025-11": 170812,
  "2025-12": 140764,
  "2026-01": 120236,
  "2026-02": 126601,
  "2026-03": 140638,
  "2026-04": 152682,
  "2026-05": 138877,
  "2026-06": 152789,
  "2026-07": 170481,
};

export function parseHistoryCsv(text: string, categoryNames: string[]): HistoryParse {
  const errors: HistoryParse["errors"] = [];
  const rows: HistoryRow[] = [];
  const canonical = new Map(categoryNames.map((n) => [n.trim().toLowerCase(), n]));
  const table = tokenizeCsv(text);
  const isBlank = (r: string[]) => r.every((c) => c.trim() === "");
  const headerIdx = table.findIndex((r) => !isBlank(r));
  if (headerIdx < 0) return { rows, errors: [{ line: 1, message: "The file is empty" }], byMonth: new Map() };
  const header = table[headerIdx]!.map((c) => c.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const [mi, ci, ai] = [col("month"), col("category"), col("amount")];
  if (mi < 0 || ci < 0 || ai < 0) {
    return { rows, errors: [{ line: headerIdx + 1, message: 'Header must have the columns "month", "category" and "amount"' }], byMonth: new Map() };
  }
  const seen = new Map<string, number>();
  for (let i = headerIdx + 1; i < table.length; i++) {
    const cells = table[i]!;
    const line = i + 1;
    if (isBlank(cells)) continue;
    const month = (cells[mi] ?? "").trim();
    const rawCat = (cells[ci] ?? "").trim();
    const amount = (cells[ai] ?? "").trim();
    if (!isMonthKey(month)) {
      errors.push({ line, message: `Month "${month}" isn't YYYY-MM` });
      continue;
    }
    const category = canonical.get(rawCat.toLowerCase());
    if (!category) {
      errors.push({ line, message: `Unknown category "${rawCat}" — create it in Settings first, or fix the name` });
      continue;
    }
    if (!isParsableMinor(amount)) {
      errors.push({ line, message: `Amount "${amount}" isn't a valid amount (at most 2 decimals)` });
      continue;
    }
    const key = `${month}|${category}`;
    if (seen.has(key)) {
      errors.push({ line, message: `${category} for ${month} appears twice (also line ${seen.get(key)})` });
      continue;
    }
    seen.set(key, line);
    rows.push({ line, month, category, amountMinor: parseMinor(amount) });
  }
  const byMonth: HistoryParse["byMonth"] = new Map();
  for (const r of rows) {
    const m = byMonth.get(r.month) ?? { totalMinor: 0, byCategory: new Map() };
    m.totalMinor += r.amountMinor;
    m.byCategory.set(r.category, r.amountMinor);
    byMonth.set(r.month, m);
  }
  return { rows, errors, byMonth: new Map([...byMonth].sort(([a], [b]) => a.localeCompare(b))) };
}

export interface TotalCheck {
  month: MonthKey;
  totalMinor: number;
  knownMinor: number | null;
  /** null when there's no known total to compare against. */
  matches: boolean | null;
}

export function checkKnownTotals(byMonth: HistoryParse["byMonth"], known: Record<string, number> = KNOWN_HISTORY_TOTALS): TotalCheck[] {
  return [...byMonth].map(([month, m]) => {
    const k = known[month] ?? null;
    return { month, totalMinor: m.totalMinor, knownMinor: k, matches: k === null ? null : k === m.totalMinor };
  });
}
