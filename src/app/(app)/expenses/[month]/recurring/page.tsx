import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { isMonthKey, monthLabel } from "@/engines/dates";
import { describeSeries, monthlyFixedTotal } from "@/engines/recurring";
import { formatUSD } from "@/engines/money";
import { MonthHeader } from "@/components/month-header";
import { requireOwnerOrRedirect } from "@/server/auth-guard";
import { getDb } from "@/server/db/client";
import * as schema from "@/server/db/schema";
import { loadRecurring } from "@/server/repos/recurring";
import { loadCategories } from "@/server/repos/rules";
import { RecurringPanel } from "./recurring-panel";

export async function generateMetadata({ params }: { params: Promise<{ month: string }> }): Promise<Metadata> {
  const { month } = await params;
  return { title: isMonthKey(month) ? `Recurring · ${monthLabel(month)}` : "Recurring" };
}

export default async function RecurringPage({ params }: { params: Promise<{ month: string }> }) {
  const owner = await requireOwnerOrRedirect();
  const { month } = await params;
  if (!isMonthKey(month)) notFound();
  const db = getDb();
  const [{ rules, overrides }, categories, [rec]] = await Promise.all([
    loadRecurring(db, owner),
    loadCategories(db, owner),
    db.select({ status: schema.months.status }).from(schema.months).where(and(eq(schema.months.ownerId, owner.id), eq(schema.months.month, month))),
  ]);
  const series = describeSeries(rules, overrides, month);
  const total = monthlyFixedTotal(series);
  const running = series.filter((s) => s.status === "active").length;
  return (
    <div className="space-y-6">
      <MonthHeader month={month} tab="recurring" />
      <section className="rounded-3xl bg-hero p-5 text-[#f7f5ef] sm:p-8">
        <p className="text-sm text-[#d8e8dd]/80">Fixed in {monthLabel(month)}</p>
        <p className="mt-2 text-5xl font-bold leading-none tracking-tight tabular-nums sm:text-6xl">{formatUSD(total, { decimals: "auto" })}</p>
        <p className="mt-4 text-sm text-[#d8e8dd]">
          {running === 0 ? "Nothing recurring this month." : `${running} recurring ${running === 1 ? "item" : "items"} counted in your spending and budget.`}
        </p>
      </section>
      <RecurringPanel
        month={month}
        closed={rec?.status === "closed"}
        series={series.map((s) => ({ ...s, versions: s.versions.map((v) => ({ effectiveFrom: v.effectiveFrom, amountMinor: v.amountMinor })) }))}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
      />
    </div>
  );
}
