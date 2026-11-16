import type { Metadata } from "next";
import { Card } from "@/components/ui";
import { requireOwnerOrRedirect } from "@/server/auth-guard";
import { getDb } from "@/server/db/client";
import { dataStatus } from "@/server/repos/overview";
import { getSettings } from "@/server/repos/settings";
import Link from "next/link";
import { loadCategories } from "@/server/repos/rules";
import { CategoriesForm } from "./categories-form";
import { ThresholdForm } from "./threshold-form";
import { signOut } from "@/auth";

function SignOutButton() {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/signin" });
      }}
    >
      <button type="submit" className="inline-flex h-11 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-medium transition hover:bg-forest-50">
        <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 4.5H5.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1H8M12 6.5l3.5 3.5-3.5 3.5M15.5 10H8.5" />
        </svg>
        Sign out
      </button>
    </form>
  );
}

export const metadata: Metadata = { title: "Settings" };

const LABELS: Record<string, string> = {
  categories: "Categories",
  budgetDefaults: "Default budgets",
  categoryMaps: "Splitwise category mappings",
  keywordRules: "Keyword rules",
  recurringRules: "Recurring rules",
  decisions: "Not-an-expense decisions",
  lenderPayments: "Lender payments",
  reimbursements: "Sister reimbursements",
  splitwiseExpenses: "Splitwise expenses",
  incomeEntries: "Income entries",
};

export default async function SettingsPage() {
  const owner = await requireOwnerOrRedirect();
  const db = getDb();
  const [settings, status, categories] = await Promise.all([getSettings(db, owner), dataStatus(db, owner), loadCategories(db, owner)]);
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Settings</h1>
      <Card title="Large expenses">
        <ThresholdForm initialMinor={settings.largeExpenseThresholdMinor} initialVersion={settings.version} />
      </Card>
      <Card title="Categories">
        <CategoriesForm categories={categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind }))} />
      </Card>
      <Card title="Data">
        <ul className="space-y-2 text-sm">
          <li>
            <Link href="/settings/backup" className="font-medium text-brand hover:underline">
              Backup &amp; export
            </Link>{" "}
            <span className="text-muted">— full backup, CSV spreadsheets, restore with a dry run</span>
          </li>
          <li>
            <Link href="/settings/history" className="font-medium text-brand hover:underline">
              Import history
            </Link>{" "}
            <span className="text-muted">— monthly category totals from old spreadsheets</span>
          </li>
          <li>
            <Link href="/expenses/import" className="font-medium text-brand hover:underline">
              Import Splitwise CSV exports
            </Link>{" "}
            <span className="text-muted">— fallback when sync isn&apos;t available</span>
          </li>
        </ul>
      </Card>
      <Card title="Account" action={<SignOutButton />}>
        <dl className="grid gap-2 text-sm sm:grid-cols-[12rem_1fr]">
          <dt className="text-muted">Signed in as</dt>
          <dd>{settings.email}</dd>
          <dt className="text-muted">Splitwise user</dt>
          <dd>{settings.splitwiseUserId ?? "Not connected yet (Phase 4)"}</dd>
        </dl>
      </Card>
      <Card title="Stored records">
        <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {Object.entries(status).map(([k, n]) => (
            <li key={k} className="flex justify-between border-b border-line/60 py-1.5">
              <span className="text-muted">{LABELS[k] ?? k}</span>
              <span className="font-medium">{n}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
