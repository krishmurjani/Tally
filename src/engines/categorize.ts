/**
 * Category resolution for a ledger row. Precedence:
 *   1. Manual override for this row (persisted, audited, resettable)
 *   2. Grocery ingredient keyword override (only for rows Splitwise filed as dining/food) → Groceries, marked auto
 *   3. Subscription (claude, netflix, …) filed under a utility category → Personal, marked auto
 *   3b. TV/Phone/Internet that is clearly a phone bill → Phone
 *   4. Saved Splitwise→app mapping (confirmed, or a suggestion Krish confirmed)
 *   5. Suggested mapping (unconfirmed) → Needs category, with the suggestion attached
 *   6. Unknown / missing Splitwise category → Needs category
 */
import { CATEGORY, SUBSCRIPTION_OVERRIDE_FROM } from "./defaults";

export interface CategoryRules {
  /** Splitwise category name → app category, confirmed. */
  confirmed: Record<string, string>;
  /** Splitwise category name → app category, suggested only. */
  suggested: Record<string, string>;
  groceryKeywords: string[];
  phoneBillKeywords: string[];
  /** Subscriptions filed under a utility category → Personal. */
  subscriptionKeywords?: string[];
  /** Splitwise categories whose rows may be re-filed as Groceries by keyword. */
  groceryOverrideFrom?: string[];
}

export type CategorySource = "manual" | "keyword" | "subscription" | "phone_bill" | "mapping" | "fixed" | "none";

export interface CategoryResolution {
  /** Resolved app category, or null when the row needs a category. */
  category: string | null;
  source: CategorySource;
  /** True when the app recategorized automatically (shown with an "auto-categorized" marker). */
  autoCategorized: boolean;
  /** Unconfirmed suggestion when category is null. */
  suggestion: string | null;
  explanation: string;
}

const DEFAULT_GROCERY_OVERRIDE_FROM = ["Dining out", "Food and drink - Other"];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Word-boundary match that also works for keywords containing punctuation (e.g. "at&t"). */
export function matchesKeyword(text: string, keyword: string): boolean {
  const k = keyword.trim();
  if (!k) return false;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(k).replace(/\s+/g, "\\s+")}(?![\\p{L}\\p{N}])`, "iu");
  return re.test(text);
}

export function findKeyword(text: string, keywords: string[]): string | null {
  return keywords.find((k) => matchesKeyword(text, k)) ?? null;
}

export interface CategorizeInput {
  description: string;
  /** Splitwise category, or null for manual/recurring rows. */
  sourceCategory: string | null;
  /** Category fixed by the row itself (manual / recurring entries). */
  fixedCategory?: string | null;
  manualOverride?: string | null;
}

export function categorize(input: CategorizeInput, rules: CategoryRules): CategoryResolution {
  if (input.manualOverride) {
    return { category: input.manualOverride, source: "manual", autoCategorized: false, suggestion: null, explanation: "Set manually" };
  }
  if (input.fixedCategory) {
    return { category: input.fixedCategory, source: "fixed", autoCategorized: false, suggestion: null, explanation: "Entered with this category" };
  }
  const sw = input.sourceCategory?.trim() || null;

  const overrideFrom = rules.groceryOverrideFrom ?? DEFAULT_GROCERY_OVERRIDE_FROM;
  if (sw && overrideFrom.includes(sw)) {
    const kw = findKeyword(input.description, rules.groceryKeywords);
    if (kw) {
      return {
        category: CATEGORY.Groceries,
        source: "keyword",
        autoCategorized: true,
        suggestion: null,
        explanation: `Splitwise said "${sw}", but "${kw}" is a store-bought ingredient → Groceries`,
      };
    }
  }

  if (sw && SUBSCRIPTION_OVERRIDE_FROM.includes(sw)) {
    const kw = findKeyword(input.description, rules.subscriptionKeywords ?? []);
    if (kw) {
      return {
        category: CATEGORY.Personal,
        source: "subscription",
        autoCategorized: true,
        suggestion: null,
        explanation: `Splitwise said "${sw}", but "${kw}" is a subscription → Personal`,
      };
    }
  }

  if (sw === "TV/Phone/Internet") {
    const kw = findKeyword(input.description, rules.phoneBillKeywords);
    if (kw) {
      return {
        category: CATEGORY.Phone,
        source: "phone_bill",
        autoCategorized: true,
        suggestion: null,
        explanation: `TV/Phone/Internet that mentions "${kw}" → Phone`,
      };
    }
  }

  if (sw && rules.confirmed[sw]) {
    return { category: rules.confirmed[sw], source: "mapping", autoCategorized: false, suggestion: null, explanation: `Splitwise "${sw}" → ${rules.confirmed[sw]}` };
  }
  if (sw && rules.suggested[sw]) {
    return {
      category: null,
      source: "none",
      autoCategorized: false,
      suggestion: rules.suggested[sw],
      explanation: `Splitwise "${sw}" isn't mapped yet (suggestion: ${rules.suggested[sw]})`,
    };
  }
  return {
    category: null,
    source: "none",
    autoCategorized: false,
    suggestion: null,
    explanation: sw ? `New Splitwise category "${sw}" — needs a category` : "No category",
  };
}
