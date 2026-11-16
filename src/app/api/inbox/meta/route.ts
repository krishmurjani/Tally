import { MAX_BODY_BYTES, MAX_ITEMS_PER_REQUEST } from "@/engines/inbox";
import { getDb } from "@/server/db/client";
import { loadInbox, ownerFromBearer } from "@/server/repos/inbox";

export const dynamic = "force-dynamic";

/** GET /api/inbox/meta — what a sender needs to know: the category names Tally uses and the limits. Same bearer token. */
export async function GET(req: Request) {
  const owner = await ownerFromBearer(getDb(), req.headers.get("authorization"));
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Type": "application/json; charset=utf-8" };
  if (!owner) return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401, headers: { ...headers, "WWW-Authenticate": 'Bearer realm="tally"' } });
  const { categories } = await loadInbox(getDb(), owner);
  return new Response(
    JSON.stringify({
      ok: true,
      categories: categories.map((c) => c.name),
      limits: { maxItemsPerRequest: MAX_ITEMS_PER_REQUEST, maxBodyKb: MAX_BODY_BYTES / 1024 },
      privateCurrency: "USD",
      itemStatuses: ["created", "duplicate_ignored", "invalid", "would_create", "would_ignore_duplicate"],
    }),
    { headers },
  );
}
