import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui";
import { requireOwnerOrRedirect } from "@/server/auth-guard";
import { RestoreForm } from "./restore-form";

export const metadata: Metadata = { title: "Backup & export" };

const CSVS = [
  ["expenses", "Expenses by month", "Every row with my share, category, status and reason"],
  ["category-summaries", "Category summaries", "Monthly totals per category (detailed and imported)"],
  ["income", "Income", "Paychecks, cash, gifts and other income"],
  ["lender-payments", "Lender payments", "HDFC Credila ledger incl. planned and bounced"],
  ["reimbursements", "Sister reimbursements", "Opening reconciliation and entries"],
  ["projection", "Payoff projection", "Month-by-month schedule from the saved plan (estimate)"],
] as const;

export default async function BackupPage() {
  await requireOwnerOrRedirect();
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Backup &amp; export</h1>
        <Link href="/settings" className="text-sm font-medium text-brand hover:underline">
          Back to settings
        </Link>
      </div>
      <Card title="Full backup">
        <p className="mb-4 text-sm text-muted">
          Everything in Tally as one versioned, compressed JSON file (<code className="rounded bg-canvas px-1">.json.gz</code>), including imported CSVs and raw Splitwise data. Keep it somewhere private.
        </p>
        <a href="/api/export/backup" className="inline-flex h-11 items-center rounded-xl bg-forest-700 px-5 text-sm font-medium text-white hover:bg-forest-800">
          Download backup
        </a>
      </Card>
      <Card title="Spreadsheets (CSV)">
        <ul className="divide-y divide-line/70">
          {CSVS.map(([kind, label, hint]) => (
            <li key={kind} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div>
                <p className="font-medium">{label}</p>
                <p className="text-sm text-muted">{hint}</p>
              </div>
              <a href={`/api/export/${kind}`} className="h-10 content-center rounded-lg border border-line px-3 text-sm font-medium hover:bg-forest-50">
                Download CSV
              </a>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Restore from a backup">
        <p className="mb-4 text-sm text-muted">Choose a backup to see exactly what would change. Nothing is written until you pick an option.</p>
        <RestoreForm />
      </Card>
    </div>
  );
}
