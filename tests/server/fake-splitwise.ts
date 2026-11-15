/** In-memory stand-in for the Splitwise API (synthetic data only). */
import type { ApiExpense, SplitwiseApi } from "@/server/splitwise/client";

export const ME = 1001;
export const ROOMMATE = 2002;
export const FRIEND = 3003;

export function makeExpense(over: Partial<ApiExpense> & { id: number; myOwed?: string; myPaid?: string }): ApiExpense {
  const { myOwed = "10.00", myPaid = "0.00", ...rest } = over;
  return {
    cost: "20.00",
    currency_code: "USD",
    date: "2026-08-15T16:00:00Z",
    description: `Expense ${over.id}`,
    category: { id: 1, name: "Groceries" },
    group_id: 77,
    payment: false,
    deleted_at: null,
    updated_at: "2026-08-15T16:00:00Z",
    users: [
      { user_id: ME, user: { first_name: "Krish", last_name: "Murjani" }, paid_share: myPaid, owed_share: myOwed, net_balance: "0" },
      { user_id: ROOMMATE, user: { first_name: "Prathamesh", last_name: "A" }, paid_share: "20.00", owed_share: "10.00", net_balance: "10.00" },
    ],
    ...rest,
  };
}

export class FakeSplitwise implements SplitwiseApi {
  expenses: ApiExpense[] = [];
  calls = 0;
  constructor(public groups = [{ id: 77, name: "18 Battery Ave" }]) {}
  async getCurrentUser() {
    this.calls++;
    return { id: ME, firstName: "Krish", lastName: "Murjani" };
  }
  async getGroups() {
    this.calls++;
    return this.groups;
  }
  async getExpenses(p: { datedAfter?: string; datedBefore?: string; updatedAfter?: string }) {
    this.calls++;
    return this.expenses
      .filter((e) => (!p.datedAfter || e.date >= p.datedAfter) && (!p.datedBefore || e.date < p.datedBefore) && (!p.updatedAfter || e.updated_at > p.updatedAfter))
      .map((e) => ({ parsed: structuredClone(e), raw: structuredClone(e) }));
  }
  edit(id: number, change: Partial<ApiExpense> & { myOwed?: string }) {
    const e = this.expenses.find((x) => x.id === id)!;
    const { myOwed, ...rest } = change;
    Object.assign(e, rest, { updated_at: new Date().toISOString() });
    if (myOwed !== undefined) e.users.find((u) => u.user_id === ME)!.owed_share = myOwed;
  }
}
