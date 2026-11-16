/**
 * Validation for expenses sent to the Inbox by an assistant. Pure: no database, no clock.
 * Anything unclear is rejected or flagged, never guessed.
 */
import { isIsoDate, type IsoDate } from "./dates";
import { isParsableMinor, parseMinor } from "./money";

export const MAX_ITEMS_PER_REQUEST = 100;
export const MAX_BODY_BYTES = 256 * 1024;

export interface ParsedInboxItem {
  externalId: string;
  date: IsoDate;
  description: string;
  amountMinor: number;
  currency: string;
  kind: "private" | "shared";
  categoryName: string | null;
  note: string | null;
  groupName: string | null;
  paidBy: string | null;
  split: { person: string; owesMinor: number }[] | null;
}

export type ParseResult = { ok: true; item: ParsedInboxItem } | { ok: false; externalId: string | null; errors: string[] };

const ID_RE = /^[A-Za-z0-9._:-]{1,120}$/;

function text(v: unknown, max: number): string | null | undefined {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return undefined; // wrong type
  const t = v.trim();
  if (t.length > max) return undefined;
  return t === "" ? null : t;
}

/** "84.37" or the number 84.37 → minor units; null if it isn't a clean amount with at most two decimals. */
function amountToMinor(v: unknown): number | null {
  const s = typeof v === "number" && Number.isFinite(v) ? String(v) : typeof v === "string" ? v.trim() : "";
  if (!isParsableMinor(s)) return null;
  return parseMinor(s);
}

export function parseInboxItem(raw: unknown): ParseResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, externalId: null, errors: ["Each item must be an object."] };
  const o = raw as Record<string, unknown>;
  const errors: string[] = [];

  const externalId = typeof o.externalId === "string" && ID_RE.test(o.externalId) ? o.externalId : null;
  if (!externalId) errors.push("externalId is required: 1–120 letters, digits or . _ : -");

  const date = typeof o.date === "string" && isIsoDate(o.date) ? o.date : null;
  if (!date) errors.push("date must be a real date like 2026-11-16");

  const description = typeof o.description === "string" ? o.description.trim() : "";
  if (!description || description.length > 200) errors.push("description is required (up to 200 characters)");

  const amountMinor = amountToMinor(o.amount);
  if (amountMinor === null) errors.push('amount must be a number with at most two decimals, e.g. "84.37"');
  else if (amountMinor <= 0) errors.push("amount must be greater than zero");

  const currencyRaw = o.currency === undefined || o.currency === null ? "USD" : o.currency;
  const currency = typeof currencyRaw === "string" && /^[A-Za-z]{3}$/.test(currencyRaw) ? currencyRaw.toUpperCase() : null;
  if (!currency) errors.push("currency must be a 3-letter code like USD");

  const kindRaw = o.type === undefined || o.type === null ? "private" : o.type;
  const kind = kindRaw === "private" || kindRaw === "shared" ? kindRaw : null;
  if (!kind) errors.push('type must be "private" or "shared"');

  const category = text(o.category, 100);
  if (category === undefined) errors.push("category must be text of up to 100 characters");
  const note = text(o.note, 500);
  if (note === undefined) errors.push("note must be text of up to 500 characters");

  let groupName: string | null = null;
  let paidBy: string | null = null;
  let split: ParsedInboxItem["split"] = null;
  if (kind === "shared") {
    const g = text(o.group, 100);
    const p = text(o.paidBy, 100);
    if (g === undefined) errors.push("group must be text of up to 100 characters");
    else groupName = g;
    if (p === undefined) errors.push("paidBy must be text of up to 100 characters");
    else paidBy = p;
    if (o.split !== undefined && o.split !== null) {
      if (!Array.isArray(o.split) || o.split.length === 0 || o.split.length > 50) {
        errors.push("split must be a list of { person, owes } entries");
      } else {
        const parsed: { person: string; owesMinor: number }[] = [];
        o.split.forEach((e, i) => {
          const entry = typeof e === "object" && e !== null ? (e as Record<string, unknown>) : {};
          const person = typeof entry.person === "string" ? entry.person.trim() : "";
          const owes = amountToMinor(entry.owes);
          if (!person || person.length > 100) errors.push(`split[${i}].person is required`);
          else if (owes === null || owes < 0) errors.push(`split[${i}].owes must be an amount like "40.00"`);
          else parsed.push({ person, owesMinor: owes });
        });
        if (parsed.length === o.split.length) {
          if (amountMinor !== null && parsed.reduce((a, b) => a + b.owesMinor, 0) !== amountMinor) {
            const sum = parsed.reduce((a, b) => a + b.owesMinor, 0);
            errors.push(`the split adds up to ${(sum / 100).toFixed(2)} but the amount is ${(amountMinor / 100).toFixed(2)}`);
          } else {
            split = parsed;
          }
        }
      }
    }
  }

  if (errors.length > 0 || !externalId || !date || amountMinor === null || !currency || !kind) {
    return { ok: false, externalId: externalId ?? (typeof o.externalId === "string" ? o.externalId.slice(0, 120) : null), errors };
  }
  return { ok: true, item: { externalId, date, description, amountMinor, currency, kind, categoryName: category ?? null, note: note ?? null, groupName, paidBy, split } };
}

/** Why an item can't be approved yet. Empty = ready. Computed fresh each time from what is stored. */
export function blockers(i: { kind: "private" | "shared"; currency: string; categoryId: string | null; monthClosed: boolean }): string[] {
  const out: string[] = [];
  if (i.kind === "shared") out.push("Shared expense — posting to Splitwise isn't set up yet");
  if (i.currency !== "USD") out.push(`In ${i.currency}; Tally tracks private spending in USD`);
  if (!i.categoryId) out.push("Choose a category");
  if (i.monthClosed) out.push("That month is closed");
  return out;
}
