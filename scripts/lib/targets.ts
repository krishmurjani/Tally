/** Reconciliation targets from the build spec (§6). */
import { CATEGORY } from "../../src/engines/defaults";
import type { ReconcileTarget } from "../../src/engines/reconcile";

export const AUGUST_2026: ReconcileTarget = {
  totalMinor: 182167,
  byCategory: {
    [CATEGORY.Rent]: 87500,
    [CATEGORY.Gas]: 2863,
    [CATEGORY.Electricity]: 7013,
    [CATEGORY.Groceries]: 15065,
    [CATEGORY.Transport]: 8057,
    [CATEGORY.Phone]: 2500,
    [CATEGORY.WiFi]: 2125,
    [CATEGORY.Laundry]: 1713,
    [CATEGORY.DiningOut]: 22557,
    [CATEGORY.Gifts]: 24602,
    [CATEGORY.Household]: 865,
    [CATEGORY.Personal]: 7307,
  },
};

/** Full-month target; the 2026-09-16 exports only cover through Sept 15–16. */
export const SEPTEMBER_2026: ReconcileTarget = { totalMinor: 191651 };

export const KNOWN_TARGETS: Record<string, ReconcileTarget> = {
  "2026-08": AUGUST_2026,
  "2026-09": SEPTEMBER_2026,
};
