/**
 * Splitwise CSV export parser.
 *
 * Format: optional preamble ("Note: does not include group expenses" on pairwise exports),
 * header `Date,Description,Category,Cost,Currency,<participant columns…>`, transaction rows
 * whose participant columns are NET balances, blank lines, and a trailing "Total balance"
 * footer row (not a transaction). Exports cover all time.
 */
import { isIsoDate, type IsoDate } from "../dates";
import { isParsableMinor, parseMinor } from "../money";

export const OWNER_NAME = "Krish Murjani";
export const PAIRWISE_PREAMBLE = "Note: does not include group expenses";
const FIXED_COLUMNS = ["Date", "Description", "Category", "Cost", "Currency"] as const;

/** RFC 4180 tokenizer: quoted fields, escaped quotes (""), CRLF/LF, newlines inside quotes. */
export function tokenizeCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === "") inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (inQuotes) throw new Error("CSV ends inside a quoted field");
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export interface CsvTransaction {
  /** 1-based physical row number in the file (for audit/discrepancy reports). */
  line: number;
  date: IsoDate;
  description: string;
  category: string;
  costRaw: string;
  costMinor: number;
  currency: string;
  /** Net balance per participant name, minor units. */
  nets: Record<string, number>;
  myNetMinor: number;
}

export interface CsvProblem {
  line: number;
  message: string;
  cells: string[];
}

export type ExportKind = "group" | "pairwise" | "self";

export interface ParsedExport {
  fileName: string;
  /** "18-battery-ave", "krish-m-and-jainam", … (from the normalized filename). */
  source: string;
  exportDate: IsoDate | null;
  kind: ExportKind;
  participants: string[];
  others: string[];
  transactions: CsvTransaction[];
  footer: { date: string; nets: Record<string, number> } | null;
  /** Rows that couldn't be parsed. They go to Needs review — never dropped silently. */
  problems: CsvProblem[];
}

const FILE_RE = /^(.+)_(\d{4}-\d{2}-\d{2})_export\.csv$/;

/** Strip "1794715392459_" prefixes and " (1)" browser suffixes; returns the normalized name. */
export function normalizeExportFileName(name: string): string {
  return name.replace(/^\d+_/, "").replace(/ \(\d+\)(?=\.csv$)/i, "");
}

export function parseExportFileName(name: string): { source: string; exportDate: IsoDate | null } {
  const m = FILE_RE.exec(normalizeExportFileName(name));
  if (!m) return { source: name.replace(/\.csv$/i, ""), exportDate: null };
  return { source: m[1]!, exportDate: isIsoDate(m[2]!) ? m[2]! : null };
}

export interface ParseOptions {
  ownerName?: string;
  /** Participant name that marks the Self group (me + this name only). */
  selfCounterparty?: string;
}

export function parseSplitwiseExport(fileName: string, text: string, opts: ParseOptions = {}): ParsedExport {
  const ownerName = opts.ownerName ?? OWNER_NAME;
  const selfCounterparty = opts.selfCounterparty ?? "Card";
  const rows = tokenizeCsv(text);
  const isBlank = (r: string[]) => r.every((c) => c.trim() === "");

  const headerIdx = rows.findIndex((r) => r[0]?.trim() === "Date" && r[1]?.trim() === "Description");
  if (headerIdx < 0) throw new Error(`${fileName}: no "Date,Description,…" header row found`);
  const header = rows[headerIdx]!.map((c) => c.trim());
  FIXED_COLUMNS.forEach((col, i) => {
    if (header[i] !== col) throw new Error(`${fileName}: expected column ${i + 1} to be "${col}", got "${header[i]}"`);
  });

  const preamble = rows.slice(0, headerIdx).filter((r) => !isBlank(r)).map((r) => r.join(",").trim());
  const unknownPreamble = preamble.filter((p) => p !== PAIRWISE_PREAMBLE);
  if (unknownPreamble.length) throw new Error(`${fileName}: unexpected text before header: ${unknownPreamble.join(" | ")}`);

  const participants = header.slice(FIXED_COLUMNS.length);
  const dupes = participants.filter((p, i) => participants.indexOf(p) !== i);
  if (dupes.length) throw new Error(`${fileName}: duplicate participant columns: ${dupes.join(", ")}`);
  const myCol = participants.indexOf(ownerName);
  if (myCol < 0) throw new Error(`${fileName}: no participant column named exactly "${ownerName}"`);
  const others = participants.filter((p) => p !== ownerName);

  const kind: ExportKind = preamble.includes(PAIRWISE_PREAMBLE)
    ? "pairwise"
    : others.length === 1 && others[0] === selfCounterparty
      ? "self"
      : "group";

  const transactions: CsvTransaction[] = [];
  const problems: CsvProblem[] = [];
  let footer: ParsedExport["footer"] = null;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const cells = rows[i]!;
    const line = i + 1;
    if (isBlank(cells)) continue;
    const [date = "", description = "", category = "", cost = "", currency = ""] = cells.map((c) => c.trim());
    const netCells = cells.slice(FIXED_COLUMNS.length);

    if (description === "Total balance") {
      if (footer) problems.push({ line, message: "second Total balance row", cells });
      const nets: Record<string, number> = {};
      participants.forEach((p, j) => {
        const v = netCells[j]?.trim() ?? "";
        if (isParsableMinor(v)) nets[p] = parseMinor(v);
      });
      footer = { date, nets };
      continue;
    }
    if (footer) {
      problems.push({ line, message: "row after the Total balance footer", cells });
      continue;
    }
    if (cells.length !== header.length) {
      problems.push({ line, message: `expected ${header.length} columns, found ${cells.length}`, cells });
      continue;
    }
    if (!isIsoDate(date)) {
      problems.push({ line, message: `invalid date "${date}"`, cells });
      continue;
    }
    const nets: Record<string, number> = {};
    let bad: string | null = null;
    participants.forEach((p, j) => {
      const v = netCells[j]!.trim();
      if (!isParsableMinor(v)) bad ??= `participant "${p}" amount "${v}" isn't a number`;
      else nets[p] = parseMinor(v);
    });
    if (!isParsableMinor(cost)) bad ??= `cost "${cost}" isn't a number`;
    if (bad) {
      problems.push({ line, message: bad, cells });
      continue;
    }
    transactions.push({
      line,
      date,
      description,
      category,
      costRaw: cost,
      costMinor: parseMinor(cost),
      currency,
      nets,
      myNetMinor: nets[ownerName]!,
    });
  }

  const { source, exportDate } = parseExportFileName(fileName);
  return { fileName, source, exportDate, kind, participants, others, transactions, footer, problems };
}
