/**
 * Splitwise REST API v3.0 client (server-side only; the API key never reaches the browser).
 * Docs: https://dev.splitwise.com/
 *   - Auth: personal API key sent as `Authorization: Bearer <key>` (per the build spec; verify on first real call).
 *   - Wrappers: {user}, {expenses}, {groups}, {friends}. Non-group expenses have group_id 0 (or null).
 *   - Paging: limit/offset. We page until an EMPTY page, so a server-side cap on `limit` can't truncate results.
 *   - 429 → back off (honouring Retry-After); 5xx/network → bounded exponential backoff.
 */
import { z } from "zod";
import type { SplitwiseExpense } from "@/engines/share";

export const SPLITWISE_BASE_URL = "https://secure.splitwise.com/api/v3.0";

const Share = z.object({
  user_id: z.number().int(),
  user: z.object({ id: z.number().int().optional(), first_name: z.string().nullable().optional(), last_name: z.string().nullable().optional() }).nullable().optional(),
  paid_share: z.string(),
  owed_share: z.string(),
  net_balance: z.string(),
});

export const ExpenseSchema = z.looseObject({
  id: z.number().int(),
  cost: z.string(),
  currency_code: z.string(),
  date: z.string(),
  description: z.string().nullable().transform((s) => s ?? ""),
  category: z.object({ id: z.number().int(), name: z.string() }).nullable().optional().transform((c) => c ?? null),
  group_id: z.number().int().nullable().optional().transform((g) => (g ? g : null)),
  payment: z.boolean(),
  deleted_at: z.string().nullable().optional().transform((d) => d ?? null),
  updated_at: z.string(),
  users: z.array(Share),
});

export type ApiExpense = SplitwiseExpense & { users: (SplitwiseExpense["users"][number] & { user?: { first_name?: string | null; last_name?: string | null } | null })[] };

const UserSchema = z.object({ id: z.number().int(), first_name: z.string().nullable().optional(), last_name: z.string().nullable().optional() });
const GroupSchema = z.object({ id: z.number().int(), name: z.string() });
const PersonSchema = z.object({ id: z.number().int(), first_name: z.string().nullable().optional(), last_name: z.string().nullable().optional() });
const toPerson = (p: z.infer<typeof PersonSchema>): SwPerson => ({ id: p.id, firstName: p.first_name ?? "", lastName: p.last_name ?? "" });

export class SplitwiseError extends Error {
  constructor(message: string, public readonly status: number | null) {
    super(message);
    this.name = "SplitwiseError";
  }
}
export class SplitwiseAuthError extends SplitwiseError {}
/** Splitwise answered and refused (bad input). Nothing was created. */
export class SplitwiseRejectedError extends SplitwiseError {}
/** The request may or may not have reached Splitwise (network error, timeout, 5xx). The expense might exist: never retry blindly. */
export class SplitwiseUncertainError extends SplitwiseError {}

export interface SwPerson {
  id: number;
  firstName: string;
  lastName: string;
}
export interface SwGroup {
  id: number;
  name: string;
  members: SwPerson[];
}
export interface CreateExpenseInput {
  /** Decimal string, e.g. "120.00". */
  cost: string;
  description: string;
  details?: string | null;
  /** ISO timestamp. We send noon UTC so the New York calendar date never shifts. */
  date: string;
  currencyCode: string;
  /** 0 = a non-group expense between friends. */
  groupId: number;
  categoryId?: number;
  shares: { userId: number; paid: string; owed: string }[];
}

export interface SplitwiseApi {
  getCurrentUser(): Promise<{ id: number; firstName: string; lastName: string }>;
  /** All expenses matching the filters, across pages. Raw JSON is returned alongside the parsed shape. */
  getExpenses(params: { datedAfter?: string; datedBefore?: string; updatedAfter?: string }): Promise<{ parsed: ApiExpense; raw: unknown }[]>;
  getGroups(): Promise<{ id: number; name: string }[]>;
  /** Groups with their members (the real group list excludes Splitwise's pseudo-group 0). */
  getGroupsWithMembers(): Promise<SwGroup[]>;
  getFriends(): Promise<SwPerson[]>;
  /** Splitwise's own categories, flattened to the choosable sub-categories (Groceries, Taxi, …). */
  getCategories(): Promise<{ id: number; name: string }[]>;
  /** Creates ONE expense. Never retried automatically after a network error or 5xx — see SplitwiseUncertainError. */
  createExpense(input: CreateExpenseInput): Promise<{ id: number; raw: unknown }>;
}

export interface ClientOptions {
  apiKey: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  baseUrl?: string;
  maxRetries?: number;
  pageSize?: number;
  /** Safety stop for runaway paging. */
  maxPages?: number;
}

/** Flatten Splitwise's {"base": ["…"], "field": ["…"]} (or a bare string/array) into one readable line. */
function describeErrors(e: unknown): string {
  if (!e) return "";
  if (typeof e === "string") return e;
  if (Array.isArray(e)) return e.map(describeErrors).filter(Boolean).join("; ");
  if (typeof e === "object") return Object.values(e as Record<string, unknown>).map(describeErrors).filter(Boolean).join("; ");
  return "";
}

export function createSplitwiseClient(opts: ClientOptions): SplitwiseApi {
  if (!opts.apiKey) throw new SplitwiseAuthError("SPLITWISE_API_KEY is not set", null);
  const doFetch = opts.fetch ?? globalThis.fetch;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const base = opts.baseUrl ?? SPLITWISE_BASE_URL;
  const maxRetries = opts.maxRetries ?? 5;
  const pageSize = opts.pageSize ?? 100;
  const maxPages = opts.maxPages ?? 500;

  async function get(path: string, query: Record<string, string | number | undefined> = {}): Promise<unknown> {
    const url = new URL(`${base}/${path}`);
    for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v));
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await doFetch(url, { headers: { Authorization: `Bearer ${opts.apiKey}`, Accept: "application/json" }, cache: "no-store" });
      } catch (e) {
        if (attempt >= maxRetries) throw new SplitwiseError(`Network error calling Splitwise: ${(e as Error).message}`, null);
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      if (res.ok) return res.json();
      if (res.status === 401 || res.status === 403) throw new SplitwiseAuthError("Splitwise rejected the API key", res.status);
      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 120) * 1000 : 1000 * 2 ** attempt;
        await sleep(wait);
        continue;
      }
      throw new SplitwiseError(`Splitwise ${path} failed with HTTP ${res.status}`, res.status);
    }
  }

  /** POST a form. Retried only when Splitwise says it hasn't processed it (429); anything else uncertain is surfaced, not repeated. */
  async function post(path: string, form: URLSearchParams): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await doFetch(`${base}/${path}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${opts.apiKey}`, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
          body: form,
          cache: "no-store",
          signal: AbortSignal.timeout(20_000),
        });
      } catch (e) {
        throw new SplitwiseUncertainError(`No answer from Splitwise (${(e as Error).message}); the expense may or may not have been created`, null);
      }
      if (res.status === 401 || res.status === 403) throw new SplitwiseAuthError("Splitwise rejected the API key", res.status);
      if (res.status === 429 && attempt < 3) {
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 60) * 1000 : 1000 * 2 ** attempt);
        continue;
      }
      if (res.status >= 500 || res.status === 429) throw new SplitwiseUncertainError(`Splitwise answered HTTP ${res.status}; the expense may or may not have been created`, res.status);
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        /* not JSON */
      }
      if (!res.ok) throw new SplitwiseRejectedError(`Splitwise refused it (HTTP ${res.status}): ${describeErrors(body) || "no reason given"}`, res.status);
      return body;
    }
  }

  return {
    async getCurrentUser() {
      const body = z.object({ user: UserSchema }).parse(await get("get_current_user"));
      return { id: body.user.id, firstName: body.user.first_name ?? "", lastName: body.user.last_name ?? "" };
    },
    async getGroups() {
      const body = z.object({ groups: z.array(GroupSchema) }).parse(await get("get_groups"));
      return body.groups;
    },
    async getGroupsWithMembers() {
      const body = z.object({ groups: z.array(z.object({ id: z.number().int(), name: z.string(), members: z.array(PersonSchema).default([]) })) }).parse(await get("get_groups"));
      return body.groups.filter((g) => g.id !== 0).map((g) => ({ id: g.id, name: g.name, members: g.members.map(toPerson) }));
    },
    async getCategories() {
      const body = z.object({ categories: z.array(z.object({ id: z.number().int(), name: z.string(), subcategories: z.array(z.object({ id: z.number().int(), name: z.string() })).default([]) })) }).parse(await get("get_categories"));
      return body.categories.flatMap((c) => c.subcategories.map((s) => ({ id: s.id, name: s.name })));
    },
    async getFriends() {
      const body = z.object({ friends: z.array(PersonSchema) }).parse(await get("get_friends"));
      return body.friends.map(toPerson);
    },
    async createExpense(input) {
      const form = new URLSearchParams({
        cost: input.cost,
        description: input.description,
        date: input.date,
        currency_code: input.currencyCode,
        group_id: String(input.groupId),
        repeat_interval: "never",
      });
      if (input.details) form.set("details", input.details);
      if (input.categoryId) form.set("category_id", String(input.categoryId));
      input.shares.forEach((sh, i) => {
        form.set(`users__${i}__user_id`, String(sh.userId));
        form.set(`users__${i}__paid_share`, sh.paid);
        form.set(`users__${i}__owed_share`, sh.owed);
      });
      const body = await post("create_expense", form);
      // Splitwise can answer 200 and still refuse, with the reasons under "errors".
      const why = describeErrors((body as { errors?: unknown } | null)?.errors);
      if (why) throw new SplitwiseRejectedError(`Splitwise refused it: ${why}`, 200);
      const made = (body as { expenses?: { id?: unknown }[] } | null)?.expenses?.[0];
      if (!made || typeof made.id !== "number") throw new SplitwiseUncertainError("Splitwise answered without saying whether the expense was created", 200);
      return { id: made.id, raw: made };
    },
    async getExpenses(params) {
      const out: { parsed: ApiExpense; raw: unknown }[] = [];
      const seen = new Set<number>();
      for (let page = 0; page < maxPages; page++) {
        const body = z
          .object({ expenses: z.array(z.unknown()) })
          .parse(
            await get("get_expenses", {
              dated_after: params.datedAfter,
              dated_before: params.datedBefore,
              updated_after: params.updatedAfter,
              limit: pageSize,
              offset: page * pageSize,
            }),
          );
        if (body.expenses.length === 0) return out;
        for (const raw of body.expenses) {
          const parsed = ExpenseSchema.parse(raw) as unknown as ApiExpense;
          if (seen.has(parsed.id)) continue; // paging overlap if data shifted mid-sync
          seen.add(parsed.id);
          out.push({ parsed, raw });
        }
      }
      throw new SplitwiseError(`Stopped after ${maxPages} pages — refusing to page forever`, null);
    },
  };
}
