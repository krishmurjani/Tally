export { addMonths, dateInMonth, monthBounds, nyDate, todayNY } from "@/engines/dates";
export { biweeklyPaydaysInMonth as biweekly } from "@/engines/income";
import type { SplitwiseExpense } from "@/engines/share";

export const ME = 1001;
export const FRIEND = 2002;

/** Build a synthetic Splitwise API expense (no real data). */
export function apiExpense(over: Partial<SplitwiseExpense> & { myOwed?: string; myPaid?: string } = {}): SplitwiseExpense {
  const { myOwed = "10.00", myPaid = "0.00", ...rest } = over;
  return {
    id: 1,
    cost: "20.00",
    currency_code: "USD",
    date: "2026-08-15T16:00:00Z",
    description: "Dinner",
    category: { id: 13, name: "Dining out" },
    group_id: null,
    payment: false,
    deleted_at: null,
    updated_at: "2026-08-15T16:00:00Z",
    users: [
      { user_id: ME, paid_share: myPaid, owed_share: myOwed, net_balance: "0" },
      { user_id: FRIEND, paid_share: "20.00", owed_share: "10.00", net_balance: "10.00" },
    ],
    ...rest,
  };
}
