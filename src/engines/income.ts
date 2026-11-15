/** Paycheck income. Missing income is "Not recorded" (null), never $0. */
import { addDays, compareMonths, monthOf, type IsoDate, type MonthKey } from "./dates";

export interface IncomeEntry {
  id: string;
  date: IsoDate;
  amountMinor: number;
  employer: string | null;
  note: string | null;
}

export interface MonthIncome {
  month: MonthKey;
  /** null when no paycheck is recorded for the month. */
  totalMinor: number | null;
  paycheckCount: number;
  entries: IncomeEntry[];
}

export function incomeForMonth(entries: IncomeEntry[], month: MonthKey): MonthIncome {
  const inMonth = entries.filter((e) => monthOf(e.date) === month).sort((a, b) => (a.date < b.date ? -1 : 1));
  return {
    month,
    totalMinor: inMonth.length ? inMonth.reduce((s, e) => s + e.amountMinor, 0) : null,
    paycheckCount: inMonth.length,
    entries: inMonth,
  };
}

/** Biweekly paydays falling in a month, from a known anchor payday. Months get 2 or 3. */
export function biweeklyPaydaysInMonth(anchor: IsoDate, month: MonthKey): IsoDate[] {
  const dayMs = 86_400_000;
  const start = Date.parse(`${month}-01T00:00:00Z`);
  const a = Date.parse(`${anchor}T00:00:00Z`);
  // First payday on/after the 1st of the month.
  const k = Math.ceil((start - a) / (14 * dayMs));
  const out: IsoDate[] = [];
  for (let d = addDays(anchor, k * 14); compareMonths(monthOf(d), month) === 0; d = addDays(d, 14)) out.push(d);
  return out;
}

export interface LeftOver {
  /** income − expenses, or null if income isn't recorded. */
  leftOverMinor: number | null;
  text: string;
}

export function leftOver(incomeMinor: number | null, expensesMinor: number): LeftOver {
  if (incomeMinor === null) return { leftOverMinor: null, text: "Not recorded" };
  return { leftOverMinor: incomeMinor - expensesMinor, text: "" };
}
