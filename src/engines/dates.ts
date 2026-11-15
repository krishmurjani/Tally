/**
 * Accounting dates are plain "YYYY-MM-DD" strings; months are "YYYY-MM".
 * "Today" and timestamp→date conversion use America/New_York.
 */

export const APP_TIME_ZONE = "America/New_York";

export type IsoDate = string; // YYYY-MM-DD
export type MonthKey = string; // YYYY-MM

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;

export function isIsoDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

export function isMonthKey(s: string): boolean {
  const m = MONTH_RE.exec(s);
  return !!m && Number(m[2]) >= 1 && Number(m[2]) <= 12;
}

export function assertIsoDate(s: string): IsoDate {
  if (!isIsoDate(s)) throw new Error(`Invalid date ${JSON.stringify(s)} (expected YYYY-MM-DD)`);
  return s;
}

export function assertMonthKey(s: string): MonthKey {
  if (!isMonthKey(s)) throw new Error(`Invalid month ${JSON.stringify(s)} (expected YYYY-MM)`);
  return s;
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

export function monthOf(date: IsoDate): MonthKey {
  return assertIsoDate(date).slice(0, 7);
}

export function monthBounds(month: MonthKey): { start: IsoDate; end: IsoDate } {
  assertMonthKey(month);
  const [y, m] = month.split("-").map(Number) as [number, number];
  return { start: `${month}-01`, end: `${month}-${String(daysInMonth(y, m)).padStart(2, "0")}` };
}

export function addMonths(month: MonthKey, n: number): MonthKey {
  assertMonthKey(month);
  const [y, m] = month.split("-").map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

export function compareMonths(a: MonthKey, b: MonthKey): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isInMonth(date: IsoDate, month: MonthKey): boolean {
  return monthOf(date) === month;
}

/** Inclusive list of months from a to b. */
export function monthRange(from: MonthKey, to: MonthKey): MonthKey[] {
  const out: MonthKey[] = [];
  for (let m = from; compareMonths(m, to) <= 0; m = addMonths(m, 1)) out.push(m);
  return out;
}

/** Date with a given day-of-month, clipped to the month's length (e.g. day 31 in Feb → 28/29). */
export function dateInMonth(month: MonthKey, day: number): IsoDate {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = Math.min(Math.max(1, day), daysInMonth(y, m));
  return `${month}-${String(d).padStart(2, "0")}`;
}

export function addDays(date: IsoDate, n: number): IsoDate {
  const [y, m, d] = assertIsoDate(date).split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const nyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Calendar date in America/New_York for an instant (ISO datetime string or Date). */
export function nyDate(instant: string | Date): IsoDate {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid timestamp ${JSON.stringify(instant)}`);
  const parts = nyFormatter.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Today's date in New York. Pass a clock in tests. */
export function todayNY(now: Date = new Date()): IsoDate {
  return nyDate(now);
}

export function currentMonthNY(now: Date = new Date()): MonthKey {
  return todayNY(now).slice(0, 7);
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function monthLabel(month: MonthKey, style: "long" | "short" = "long"): string {
  const [y, m] = assertMonthKey(month).split("-").map(Number) as [number, number];
  const name = MONTH_NAMES[m - 1]!;
  return `${style === "short" ? name.slice(0, 3) : name} ${y}`;
}
