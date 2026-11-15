/**
 * Confirmed defaults from the build spec. Used by the engines' tests and by the seed script.
 * All amounts are USD minor units.
 */

export const CATEGORY = {
  Rent: "Rent",
  Gas: "Gas (home utility)",
  Electricity: "Electricity",
  Groceries: "Groceries",
  Transport: "Transport",
  Phone: "Phone",
  WiFi: "Wi-Fi",
  Laundry: "Laundry",
  DiningOut: "Dining Out",
  Gifts: "Gifts",
  Household: "Household",
  Personal: "Personal",
  Travel: "Travel",
} as const;

export const NEEDS_CATEGORY = "Needs category";

/** Built-in categories, in display order, with default monthly budgets. */
export const DEFAULT_BUDGETS: { name: string; budgetMinor: number }[] = [
  { name: CATEGORY.Rent, budgetMinor: 87500 },
  { name: CATEGORY.Gas, budgetMinor: 4000 },
  { name: CATEGORY.Electricity, budgetMinor: 10000 },
  { name: CATEGORY.Groceries, budgetMinor: 10000 },
  { name: CATEGORY.Transport, budgetMinor: 5000 },
  { name: CATEGORY.Phone, budgetMinor: 2500 },
  { name: CATEGORY.WiFi, budgetMinor: 1800 },
  { name: CATEGORY.Laundry, budgetMinor: 1000 },
  { name: CATEGORY.DiningOut, budgetMinor: 10000 },
  { name: CATEGORY.Gifts, budgetMinor: 5000 },
  { name: CATEGORY.Household, budgetMinor: 0 },
  { name: CATEGORY.Personal, budgetMinor: 0 },
];

/** Splitwise category → app category (confirmed by Krish). */
export const CONFIRMED_SPLITWISE_MAP: Record<string, string> = {
  "Heat/gas": CATEGORY.Gas,
  Taxi: CATEGORY.Transport,
  "Bus/train": CATEGORY.Transport,
  "Transportation - Other": CATEGORY.Transport,
  "TV/Phone/Internet": CATEGORY.WiFi,
  Internet: CATEGORY.WiFi,
  Phone: CATEGORY.Phone,
  Electricity: CATEGORY.Electricity,
  Groceries: CATEGORY.Groceries,
  Electronics: CATEGORY.Personal,
  "Life - Other": CATEGORY.Personal,
  Liquor: CATEGORY.DiningOut,
  "Dining out": CATEGORY.DiningOut,
  Laundry: CATEGORY.Laundry,
  Services: CATEGORY.Laundry,
  Cleaning: CATEGORY.Laundry,
  "Household supplies": CATEGORY.Household,
  Insurance: CATEGORY.Personal,
  Clothing: CATEGORY.Personal,
  Movies: CATEGORY.Personal,
  Music: CATEGORY.Personal,
  General: CATEGORY.Personal,
  Gifts: CATEGORY.Gifts,
};

/** Suggested, NOT confirmed: shown as a suggestion until Krish confirms once. */
export const SUGGESTED_SPLITWISE_MAP: Record<string, string> = {
  Car: CATEGORY.Transport,
  "Gas/fuel": CATEGORY.Transport, // vehicle fuel — never home Gas
  Parking: CATEGORY.Transport,
  Bicycle: CATEGORY.Transport,
  Plane: CATEGORY.Travel,
  Hotel: CATEGORY.Travel,
  Furniture: CATEGORY.Household,
  "Home - Other": CATEGORY.Household,
  "Food and drink - Other": CATEGORY.DiningOut,
  "Utilities - Other": CATEGORY.Personal,
};

/** Store-bought ingredients that Splitwise often files as Dining out. Matched on word boundaries. */
export const DEFAULT_GROCERY_KEYWORDS = ["dosa batter", "roti", "chapati", "phulka", "paneer"];

/**
 * Subscriptions (software, streaming) → Personal, never Wi-Fi/utilities. Only applied to rows Splitwise
 * filed under the utility categories below; kept narrow on purpose (plain "apple" would catch "apple cider").
 */
export const DEFAULT_SUBSCRIPTION_KEYWORDS = [
  "claude", "chatgpt", "openai", "netflix", "spotify", "hulu", "youtube premium", "disney+", "apple one", "icloud",
];
export const SUBSCRIPTION_OVERRIDE_FROM = ["TV/Phone/Internet", "Internet", "Utilities - Other"];

/** Descriptions that make a TV/Phone/Internet expense "clearly a phone bill". */
export const DEFAULT_PHONE_BILL_KEYWORDS = ["phone bill", "mobile", "cell phone", "t-mobile", "verizon", "at&t", "mint mobile"];

export const DEFAULT_LARGE_EXPENSE_THRESHOLD_MINOR = 10000;

export interface RecurringRuleSeed {
  name: string;
  category: string;
  amountMinor: number;
  effectiveFrom: string; // YYYY-MM
  dayOfMonth: number;
}

export const DEFAULT_RECURRING: RecurringRuleSeed[] = [
  { name: "Rent", category: CATEGORY.Rent, amountMinor: 87500, effectiveFrom: "2026-08", dayOfMonth: 1 },
  { name: "Phone", category: CATEGORY.Phone, amountMinor: 2500, effectiveFrom: "2026-08", dayOfMonth: 1 },
];

/** Pre-seeded "Not an expense" decisions (matched by date + description + cost on first sync). */
export const PRESEEDED_DECISIONS = [
  {
    date: "2026-09-01",
    description: "Varun Gas Refund",
    costMinor: 19328,
    group: "18-battery-ave",
    reason: "Roommates' money passed through me — balance adjustment",
  },
  {
    date: "2026-09-01",
    description: "Varun - Gas Refund",
    costMinor: 15798,
    group: "Prathamesh A",
    reason: "Same — balance adjustment",
  },
  {
    date: "2026-10-01",
    description: "Sent Sept 1",
    costMinor: 11876,
    group: "18-battery-ave",
    reason: "Money moving between me and Yash — not spending",
  },
] as const;
