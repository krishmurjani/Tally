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
  incomeEntries: "Paychecks",
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
      <Card title="History">
        <p className="text-sm text-muted">
          Import monthly category totals from old spreadsheets.{" "}
          <Link href="/settings/history" className="font-medium text-forest-700 hover:underline">
            Import history
          </Link>
        </p>
      </Card>
      <Card title="Account">
        <dl className="grid gap-2 text-sm sm:grid-cols-[12rem_1fr]">
          <dt className="text-muted">Signed in as</dt>
          <dd>{settings.email}</dd>
          <dt className="text-muted">Splitwise user</dt>
          <dd>{settings.splitwiseUserId ?? "Not connected yet (Phase 4)"}</dd>
        </dl>
      </Card>
      <Card title="Data">
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
