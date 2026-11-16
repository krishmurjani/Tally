export const INCOME_SOURCE_LABEL = {
  employer: "Employer",
  cash: "Cash received",
  gift_family: "Gift from family",
  gift_card: "Gift card",
  other: "Other",
} as const;

export type IncomeSourceType = keyof typeof INCOME_SOURCE_LABEL;
export const INCOME_SOURCE_OPTIONS = Object.entries(INCOME_SOURCE_LABEL) as [IncomeSourceType, string][];

/** The employer you're paid by (paid biweekly). Pre-filled for new employer income. */
export const DEFAULT_EMPLOYER = "UNYT";
/** A known payday (Fri 6 Nov 2026); paydays repeat every 14 days from here. Nothing before it is assumed. */
export const PAYDAY_ANCHOR = "2026-11-06";
