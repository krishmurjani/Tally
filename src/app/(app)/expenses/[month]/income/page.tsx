import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isMonthKey, monthLabel } from "@/engines/dates";
import { Usd } from "@/components/money";
import { MonthHeader } from "@/components/month-header";
import { Card, EmptyState, Stat } from "@/components/ui";
import { requireOwnerOrRedirect } from "@/server/auth-guard";
import { getDb } from "@/server/db/client";
import { loadMonthView } from "@/server/month-data";
import { listIncome } from "@/server/repos/income";
import { IncomePanel } from "./income-panel";

export async function generateMetadata({ params }: { params: Promise<{ month: string }> }): Promise<Metadata> {
  const { month } = await params;
  return { title: isMonthKey(month) ? `Income · ${monthLabel(month)}` : "Income" };
}

export default async function IncomePage({ params }: { params: Promise<{ month: string }> }) {
  const owner = await requireOwnerOrRedirect();
  const { month } = await params;
  if (!isMonthKey(month)) notFound();
  const db = getDb();
  const [v, all] = await Promise.all([loadMonthView(db, owner, month), listIncome(db, owner)]);
  const income = v.income.totalMinor;
  const spent = v.summary?.totalMinor ?? null;
  const lastEmployer = [...all].reverse().find((e) => e.employer)?.employer ?? "";
  return (
    <div className="space-y-6">
      <MonthHeader month={month} tab="income" />
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <Stat
            label="Income"
            value={income === null ? "Not recorded" : <Usd minor={income} />}
            hint={v.income.entries.length ? `${v.income.entries.length} paycheck${v.income.entries.length === 1 ? "" : "s"} (biweekly months have 2 or 3)` : "No paychecks recorded"}
          />
        </Card>
        <Card>
          <Stat label="Spent" value={spent === null ? "Not recorded" : <Usd minor={spent} />} hint={v.isCurrentMonth ? "Month to date" : undefined} />
        </Card>
        <Card>
          <Stat
            label="Left over"
            value={v.summary?.leftOverMinor == null ? "Not recorded" : <Usd minor={v.summary.leftOverMinor} className={v.summary.leftOverMinor < 0 ? "text-danger" : ""} />}
            hint={income === null ? "Needs income" : spent === null ? "Needs spending data" : "Income − expenses"}
          />
        </Card>
      </div>
      <Card title="Paychecks">
        {v.income.entries.length === 0 && (
          <div className="mb-4">
            <EmptyState title="Not recorded">Add each take-home paycheck dated in {monthLabel(month)}.</EmptyState>
          </div>
        )}
        <IncomePanel month={month} entries={v.income.entries} lastEmployer={lastEmployer} />
      </Card>
    </div>
  );
}
