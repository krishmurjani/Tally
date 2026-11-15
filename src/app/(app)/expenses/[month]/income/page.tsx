import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isMonthKey, monthLabel } from "@/engines/dates";
import { Usd } from "@/components/money";
import { MonthHeader } from "@/components/month-header";
import { Card, EmptyState, Stat } from "@/components/ui";
import { requireOwnerOrRedirect } from "@/server/auth-guard";
import { getDb } from "@/server/db/client";
import { loadMonthView } from "@/server/month-data";
import { AddIncomeButton, IncomePanel } from "./income-panel";

export async function generateMetadata({ params }: { params: Promise<{ month: string }> }): Promise<Metadata> {
  const { month } = await params;
  return { title: isMonthKey(month) ? `Income · ${monthLabel(month)}` : "Income" };
}

export default async function IncomePage({ params }: { params: Promise<{ month: string }> }) {
  const owner = await requireOwnerOrRedirect();
  const { month } = await params;
  if (!isMonthKey(month)) notFound();
  const db = getDb();
  const v = await loadMonthView(db, owner, month);
  const income = v.income.totalMinor;
  const spent = v.summary?.totalMinor ?? null;
  return (
    <div className="space-y-6">
      <MonthHeader month={month} tab="income" />
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <Stat
            label="Income"
            value={income === null ? "Not recorded" : <Usd minor={income} />}
            hint={v.income.entries.length ? `${v.income.entries.length} entr${v.income.entries.length === 1 ? "y" : "ies"} this month` : "Nothing recorded"}
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
      <Card title="Income" action={v.income.entries.length ? <AddIncomeButton month={month} /> : undefined}>
        {v.income.entries.length === 0 && (
          <div className="mb-4">
            <EmptyState title="Not recorded">Add your paychecks (UNYT, biweekly), cash, gifts or anything else received in {monthLabel(month)}.</EmptyState>
          </div>
        )}
        <IncomePanel month={month} entries={v.income.entries} />
      </Card>
    </div>
  );
}
