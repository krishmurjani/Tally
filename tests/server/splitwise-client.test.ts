import { describe, expect, it } from "vitest";
import { createSplitwiseClient, SplitwiseAuthError, SplitwiseError } from "@/server/splitwise/client";

const exp = (id: number) => ({
  id,
  cost: "10.00",
  currency_code: "USD",
  date: "2026-08-10T16:00:00Z",
  description: `e${id}`,
  category: { id: 1, name: "General" },
  group_id: 0,
  payment: false,
  deleted_at: null,
  updated_at: "2026-08-10T16:00:00Z",
  users: [{ user_id: 1, user: { first_name: "K", last_name: "M" }, paid_share: "10.00", owed_share: "5.00", net_balance: "5.00" }],
});

function fakeFetch(handler: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init: init ?? {} });
    return handler(url, init ?? {});
  }) as typeof fetch;
  return { f, calls };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const noSleep = async () => {};

describe("Splitwise client", () => {
  it("sends the API key as a Bearer token", async () => {
    const { f, calls } = fakeFetch(() => json({ user: { id: 42, first_name: "Krish", last_name: "M" } }));
    const me = await createSplitwiseClient({ apiKey: "k3y", fetch: f, sleep: noSleep }).getCurrentUser();
    expect(me.id).toBe(42);
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer k3y");
    expect(calls[0]!.url.pathname).toBe("/api/v3.0/get_current_user");
  });

  it("pages with limit/offset until an empty page (even if the server caps the page size)", async () => {
    const all = Array.from({ length: 7 }, (_, i) => exp(i + 1));
    const { f, calls } = fakeFetch((url) => {
      const off = Number(url.searchParams.get("offset"));
      return json({ expenses: all.slice(off, off + 3) }); // server ignores limit=100, returns 3
    });
    const out = await createSplitwiseClient({ apiKey: "k", fetch: f, sleep: noSleep, pageSize: 3 }).getExpenses({ datedAfter: "2026-07-31T00:00:00Z", datedBefore: "2026-09-02T00:00:00Z" });
    expect(out.map((e) => e.parsed.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(calls[0]!.url.searchParams.get("dated_after")).toBe("2026-07-31T00:00:00Z");
    expect(calls[0]!.url.searchParams.get("dated_before")).toBe("2026-09-02T00:00:00Z");
    expect(calls.at(-1)!.url.searchParams.get("offset")).toBe("9");
  });

  it("keeps the raw JSON and normalizes group_id 0 to null", async () => {
    const { f } = fakeFetch((url) => json({ expenses: url.searchParams.get("offset") === "0" ? [{ ...exp(1), extra_field: "kept" }] : [] }));
    const [e] = await createSplitwiseClient({ apiKey: "k", fetch: f, sleep: noSleep }).getExpenses({});
    expect(e!.parsed.group_id).toBeNull();
    expect((e!.raw as Record<string, unknown>).extra_field).toBe("kept");
  });

  it("backs off on 429 honouring Retry-After, then succeeds", async () => {
    const waits: number[] = [];
    let n = 0;
    const { f } = fakeFetch(() => (n++ < 2 ? json({}, 429, { "retry-after": "3" }) : json({ groups: [{ id: 5, name: "18 Battery Ave" }] })));
    const groups = await createSplitwiseClient({ apiKey: "k", fetch: f, sleep: async (ms) => void waits.push(ms) }).getGroups();
    expect(groups).toEqual([{ id: 5, name: "18 Battery Ave" }]);
    expect(waits).toEqual([3000, 3000]);
  });

  it("retries 5xx with exponential backoff and gives up after the limit", async () => {
    const waits: number[] = [];
    const { f, calls } = fakeFetch(() => json({}, 503));
    await expect(createSplitwiseClient({ apiKey: "k", fetch: f, sleep: async (ms) => void waits.push(ms), maxRetries: 3 }).getGroups()).rejects.toBeInstanceOf(SplitwiseError);
    expect(calls).toHaveLength(4);
    expect(waits).toEqual([1000, 2000, 4000]);
  });

  it("does not retry a rejected key", async () => {
    const { f, calls } = fakeFetch(() => json({}, 401));
    await expect(createSplitwiseClient({ apiKey: "bad", fetch: f, sleep: noSleep }).getCurrentUser()).rejects.toBeInstanceOf(SplitwiseAuthError);
    expect(calls).toHaveLength(1);
  });

  it("refuses to start without a key", () => {
    expect(() => createSplitwiseClient({ apiKey: "" })).toThrow(SplitwiseAuthError);
  });
});
