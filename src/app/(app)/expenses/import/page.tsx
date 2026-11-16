import type { Metadata } from "next";
import Link from "next/link";
import { currentMonthNY } from "@/engines/dates";
import { Card } from "@/components/ui";
import { requireOwnerOrRedirect } from "@/server/auth-guard";
import { getDb } from "@/server/db/client";
import { listCsvImports } from "@/server/repos/csv-import";
import { UploadForm } from "./upload-form";

export const metadata: Metadata = { title: "Import CSV" };

export default async function ImportPage() {
  const owner = await requireOwnerOrRedirect();
  const files = await listCsvImports(getDb(), owner);
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Import Splitwise CSV exports</h1>
        <Link href={`/expenses/${currentMonthNY()}`} className="text-sm font-medium text-brand hover:underline">
          Back to expenses
        </Link>
      </div>
      <Card title="Upload">
        <p className="mb-4 text-sm text-muted">
          A fallback for when Splitwise sync isn&apos;t available. Export each group and friend from Splitwise (Settings → Export as spreadsheet) and upload them together. Newer exports of the same group replace older ones; nothing is added twice. A month only uses these files once you switch it to “CSV import”.
        </p>
        <UploadForm />
      </Card>
      <Card title={`Imported files · ${files.length}`}>
        {files.length === 0 ? (
          <p className="text-sm text-muted">None yet.</p>
        ) : (
          <ul className="divide-y divide-line/70 text-sm">
            {files
              .sort((a, b) => a.fileName.localeCompare(b.fileName))
              .map((f) => (
                <li key={f.id} className="flex justify-between gap-3 py-2">
                  <span>{f.fileName}</span>
                  <span className="text-muted">{f.rowCount} rows</span>
                </li>
              ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
