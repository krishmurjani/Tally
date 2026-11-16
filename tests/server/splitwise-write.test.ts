// create_expense against a scripted fetch — nothing here talks to the real Splitwise.
import { describe, expect, it } from "vitest";
import { createSplitwiseClient, SplitwiseAuthError, SplitwiseRejectedError, SplitwiseUncertainError } from "@/server/splitwise/client";

const input = {
  cost: "120.00",
  description: "Dinner",
  details: "note",
  date: "2026-11-16T12:00:00Z",
  currencyCode: "USD",
  groupId: 77,
  shares: [
    { userId: 1, paid: "120.00", owed: "40.00" },
    { userId: 2, paid: "0.00", owed: "80.00" },
  ],
};
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });

function scripted(...responses: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string | URL, init: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = responses.shift();
    if (!r) throw new Error("unexpected extra request");
    if (r instanceof Error) throw r;
    return r;
  }) as unknown as typeof fetch;
  const sleeps: number[] = [];
  const api = createSplitwiseClient({ apiKey: "k", fetch: f, sleep: async (ms) => void sleeps.push(ms) });
  return { api, calls, sleeps };
}

describe("create_expense", () => {
  it("sends one form-encoded POST with the exact shares, and returns the new id", async () => {
    const { api, calls } = scripted(json({ expenses: [{ id: 555 }], errors: {} }));
    expect(await api.createExpense(input)).toMatchObject({ id: 555 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://secure.splitwise.com/api/v3.0/create_expense");
    expect(calls[0]!.init.method).toBe("POST");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer k");
    const body = new URLSearchParams(String(calls[0]!.init.body));
    expect(Object.fromEntries(body)).toEqual({
      cost: "120.00",
      description: "Dinner",
      details: "note",
      date: "2026-11-16T12:00:00Z",
      currency_code: "USD",
      group_id: "77",
      repeat_interval: "never",
      users__0__user_id: "1",
      users__0__paid_share: "120.00",
      users__0__owed_share: "40.00",
      users__1__user_id: "2",
      users__1__paid_share: "0.00",
      users__1__owed_share: "80.00",
    });
  });

  it("includes the Splitwise category when one is given, and leaves it out when not", async () => {
    const a = scripted(json({ expenses: [{ id: 1 }], errors: {} }));
    await a.api.createExpense({ ...input, categoryId: 12 });
    expect(new URLSearchParams(String(a.calls[0]!.init.body)).get("category_id")).toBe("12");
    const b = scripted(json({ expenses: [{ id: 2 }], errors: {} }));
    await b.api.createExpense(input);
    expect(new URLSearchParams(String(b.calls[0]!.init.body)).has("category_id")).toBe(false);
  });

  it("a 200 that carries errors is a refusal, not a success", async () => {
    const { api } = scripted(json({ expenses: [], errors: { base: ["The total of everyone's owed shares must equal the cost"] } }));
    await expect(api.createExpense(input)).rejects.toThrow(SplitwiseRejectedError);
  });

  it("a 4xx is a refusal with Splitwise's reason", async () => {
    const { api } = scripted(json({ errors: { base: ["Invalid group"] } }, 400));
    await expect(api.createExpense(input)).rejects.toThrow(/Invalid group/);
  });

  it("a 5xx is UNCERTAIN and is never retried: it might have been created", async () => {
    const { api, calls } = scripted(json({}, 500), json({ expenses: [{ id: 1 }], errors: {} }));
    await expect(api.createExpense(input)).rejects.toThrow(SplitwiseUncertainError);
    expect(calls).toHaveLength(1);
  });

  it("a network failure is UNCERTAIN and is never retried", async () => {
    const { api, calls } = scripted(new Error("socket hang up"), json({ expenses: [{ id: 1 }], errors: {} }));
    await expect(api.createExpense(input)).rejects.toThrow(SplitwiseUncertainError);
    expect(calls).toHaveLength(1);
  });

  it("a 200 with no expense id is uncertain, not assumed created", async () => {
    const { api } = scripted(json({ expenses: [], errors: {} }));
    await expect(api.createExpense(input)).rejects.toThrow(SplitwiseUncertainError);
  });

  it("429 means 'not processed': it waits as told and tries again", async () => {
    const { api, calls, sleeps } = scripted(json({}, 429, { "retry-after": "2" }), json({ expenses: [{ id: 9 }], errors: {} }));
    expect(await api.createExpense(input)).toMatchObject({ id: 9 });
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([2000]);
  });

  it("a rejected key is an auth error", async () => {
    const { api } = scripted(json({}, 401));
    await expect(api.createExpense(input)).rejects.toThrow(SplitwiseAuthError);
  });
});
