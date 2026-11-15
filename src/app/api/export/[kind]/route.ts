import { todayNY } from "@/engines/dates";
import { requireOwner } from "@/server/auth-guard";
import { createBackup, encodeBackup } from "@/server/backup";
import { getDb } from "@/server/db/client";
import { EXPORT_KINDS, exportCsv, type ExportKind } from "@/server/exports";
import { UnauthorizedError } from "@/server/owner-core";

export async function GET(_req: Request, ctx: { params: Promise<{ kind: string }> }) {
  let owner;
  try {
    owner = await requireOwner();
  } catch (e) {
    if (e instanceof UnauthorizedError) return new Response("Not signed in as the owner", { status: 401 });
    throw e;
  }
  const { kind } = await ctx.params;
  const date = todayNY();
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (kind === "backup") {
    const body = encodeBackup(await createBackup(getDb(), owner));
    return new Response(new Uint8Array(body), {
      headers: { ...headers, "Content-Type": "application/gzip", "Content-Disposition": `attachment; filename="tally-backup-${date}.json.gz"` },
    });
  }
  if (!(EXPORT_KINDS as readonly string[]).includes(kind)) return new Response("Unknown export", { status: 404 });
  const csv = await exportCsv(getDb(), owner, kind as ExportKind);
  return new Response(csv, {
    headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="tally-${kind}-${date}.csv"` },
  });
}
