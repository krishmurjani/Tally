import { MAX_BODY_BYTES, MAX_ITEMS_PER_REQUEST } from "@/engines/inbox";
import { getDb } from "@/server/db/client";
import { UserFacingError } from "@/server/repos/errors";
import { ingestInbox, ownerFromBearer } from "@/server/repos/inbox";

export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Type": "application/json; charset=utf-8" };
const json = (status: number, body: unknown, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });

/**
 * POST /api/inbox — send a batch of expenses to the Inbox for review. Nothing is posted anywhere.
 *   Authorization: Bearer tly_…            (create one in Settings → API access)
 *   Body: { "items": [ … ], "dryRun": false }   or add ?dryRun=true to check without saving
 * Always answers 200 with a status per item once the token and body are valid; see the README for the format.
 */
export async function POST(req: Request) {
  const owner = await ownerFromBearer(getDb(), req.headers.get("authorization"));
  if (!owner) return json(401, { ok: false, error: "unauthorized" }, { "WWW-Authenticate": 'Bearer realm="tally"' });

  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return json(413, { ok: false, error: `Body is too large (max ${MAX_BODY_BYTES / 1024} KB).` });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, { ok: false, error: "The body isn't valid JSON." });
  }
  const items = typeof body === "object" && body !== null ? (body as { items?: unknown }).items : undefined;
  if (!Array.isArray(items)) return json(400, { ok: false, error: 'Send { "items": [ … ] }.' });
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "true" || (body as { dryRun?: unknown }).dryRun === true;

  try {
    const results = await ingestInbox(getDb(), owner, items, { dryRun });
    const counts: Record<string, number> = {};
    for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return json(200, { ok: true, dryRun, counts, needsReview: results.filter((r) => (r.blockers?.length ?? 0) > 0).length, results });
  } catch (e) {
    if (e instanceof UserFacingError) return json(400, { ok: false, error: e.message, maxItemsPerRequest: MAX_ITEMS_PER_REQUEST });
    throw e;
  }
}
