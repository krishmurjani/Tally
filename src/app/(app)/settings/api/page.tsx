import type { Metadata } from "next";
import Link from "next/link";
import { requireOwnerOrRedirect } from "@/server/auth-guard";
import { getDb } from "@/server/db/client";
import { listApiTokens } from "@/server/repos/inbox";
import { ApiAccess } from "./api-access";

export const metadata: Metadata = { title: "API access" };

export default async function ApiAccessPage() {
  const owner = await requireOwnerOrRedirect();
  const tokens = await listApiTokens(getDb(), owner);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">API access</h1>
        <Link href="/settings" className="text-sm font-medium text-brand hover:underline">
          ← Settings
        </Link>
      </div>
      <ApiAccess
        tokens={tokens.map((t) => ({ id: t.id, name: t.name, prefix: t.prefix, lastUsedAt: t.lastUsedAt?.toISOString() ?? null, revokedAt: t.revokedAt?.toISOString() ?? null, createdAt: t.createdAt.toISOString() }))}
      />
    </div>
  );
}
