import type { Metadata } from "next";
import Link from "next/link";
import { monthLabel } from "@/engines/dates";
import { formatUSD } from "@/engines/money";
import { Card } from "@/components/ui";
import { requireOwnerOrRedirect } from "@/server/auth-guard";
import { getDb } from "@/server/db/client";
import { loadSummaries } from "@/server/repos/history";
import { HistoryImport } from "./history-import";

export const metadata: Metadata = { title: "Import history" };

export default async function HistoryPage() {
  const owner = await requireOwnerOrRedirect();
  const summaries = [...(await loadSummaries(getDb(), owner))].sort(([a], [b]) => b.localeCompare(a));
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Import monthly history</h1>
        <Link href="/settings" className="text-sm font-medium text-forest-700 hover:underline">
          Back to settings
        </Link>
      </div>
      <Card title="Upload a summary CSV">
        <p className="mb-4 text-sm text-muted">
          One row per month and category, with the header <code className="rounded bg-canvas px-1">month,category,amount</code> (e.g. <code className="rounded bg-canvas px-1">2025-05,Groceries,120.50</code>). Category names must match
          your categories. Totals are checked against the known monthly totals before anything is saved. Re-importing a month replaces its summary; months with detailed data keep using the detail.
        </p>
        <HistoryImport />
      </Card>
      <Card title={`Imported months · ${summaries.length}`}>
        {summaries.length === 0 ? (
          <p className="text-sm text-muted">None yet. Months without data show “No data”, never $0.</p>
        ) : (
          <ul className="grid gap-x-6 text-sm sm:grid-cols-2">
            {summaries.map(([m, cats]) => (
              <li key={m} className="flex justify-between border-b border-line/60 py-1.5">
                <Link href={`/expenses/${m}`} className="text-forest-700 hover:underline">
                  {monthLabel(m)}
                </Link>
                <span className="tabular-nums">{formatUSD([...cats.values()].reduce((a, b) => a + b, 0))}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
