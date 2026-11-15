import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { currentMonthNY, isMonthKey, monthLabel } from "@/engines/dates";
import { MonthPicker } from "@/components/month-picker";
import { Card, EmptyState } from "@/components/ui";
import { requireOwnerOrRedirect } from "@/server/auth-guard";

export async function generateMetadata({ params }: { params: Promise<{ month: string }> }): Promise<Metadata> {
  const { month } = await params;
  return { title: isMonthKey(month) ? monthLabel(month) : "Expenses" };
}

export default async function MonthPage({ params }: { params: Promise<{ month: string }> }) {
  await requireOwnerOrRedirect();
  const { month } = await params;
  if (!isMonthKey(month)) notFound();
  const current = currentMonthNY();
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthPicker month={month} basePath="/expenses" current={current} />
        <div className="flex gap-1 rounded-xl border border-line bg-surface p-1 text-sm" role="tablist" aria-label="Expenses views">
          {["Spending", "Income", "Insights"].map((t, i) => (
            <span key={t} role="tab" aria-selected={i === 0} className={`rounded-lg px-3 py-2 ${i === 0 ? "bg-forest-50 font-medium text-forest-800" : "text-faint"}`}>
              {t}
            </span>
          ))}
        </div>
      </div>
      <Card title="My spending">
        <EmptyState title="Not recorded">Splitwise sync and the transaction list arrive in Phase 4.</EmptyState>
      </Card>
    </div>
  );
}
