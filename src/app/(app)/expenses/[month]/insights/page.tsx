import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { addMonths, isMonthKey, monthLabel } from "@/engines/dates";
import { categoryChanges } from "@/engines/insights";
import { formatUSD } from "@/engines/money";
import { MonthHeader } from "@/components/month-header";
import { Badge, Card, EmptyState } from "@/components/ui";
import { requireOwnerOrRedirect } from "@/server/auth-guard";
import { getDb } from "@/server/db/client";
import { loadMonthView, monthlySeries } from "@/server/month-data";
import { BudgetBars, IncomeVsExpenses, SpendingDonut, TrendBars } from "./charts";

export async function generateMetadata({ params }: { params: Promise<{ month: string }> }): Promise<Metadata> {
  const { month } = await params;
  return { title: isMonthKey(month) ? `Insights · ${monthLabel(month)}` : "Insights" };
}

export default async function InsightsPage({ params }: { params: Promise<{ month: string }> }) {
  const owner = await requireOwnerOrRedirect();
  const { month } = await params;
  if (!isMonthKey(month)) notFound();
  const db = getDb();
  const [v, series] = await Promise.all([loadMonthView(db, owner, month), monthlySeries(db, owner)]);
  const s = v.summary;
  const prevPoint = series.find((p) => p.month === addMonths(month, -1) && p.hasSpending);
  const changes = s ? categoryChanges(new Map(s.byCategory.map((c) => [c.category, c.actualMinor])), new Map(Object.entries(prevPoint?.byCategory ?? {}))) : [];
  const trend = series.map((p) => ({ month: p.month, total: p.hasSpending ? p.totalMinor : null, income: p.incomeMinor, partial: p.partial, summary: p.kind === "summary" }));
  const large = v.rows.filter((r) => r.flags.includes("large") && r.status === "included");
  const partialNote = v.isCurrentMonth ? " (month to date)" : v.csv?.partial.some((p) => p.coverage === "mtd") ? " (partial data)" : "";

  return (
    <div className="space-y-6">
      <MonthHeader month={month} tab="insights" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Where did my money go in ${monthLabel(month)}?${partialNote}`}>
          {s && s.totalMinor > 0 ? (
            <SpendingDonut data={s.byCategory.map((c) => ({ category: c.category, minor: c.actualMinor }))} />
          ) : (
            <EmptyState title="Not recorded">No spending recorded for this month.</EmptyState>
          )}
        </Card>
        <Card title={`Which categories went over budget?${partialNote}`}>
          {s ? (
            <BudgetBars data={s.byCategory.map((c) => ({ category: c.category, actual: c.actualMinor, budget: c.budgetMinor, status: c.status.text, over: c.status.kind === "over" }))} />
          ) : (
            <EmptyState title="Not recorded">No spending recorded for this month.</EmptyState>
          )}
        </Card>
      </div>

      <Card title="How is my spending trending?">
        {trend.some((t) => t.total !== null) ? <TrendBars points={trend} /> : <EmptyState title="No data yet">Months appear here once they have spending recorded or an imported summary.</EmptyState>}
      </Card>

      <Card title="Did I spend less than I earned?">
        {trend.some((t) => t.income !== null) ? (
          <IncomeVsExpenses points={trend} />
        ) : (
          <EmptyState title="No income recorded">Add income on the Income tab to compare income with spending.</EmptyState>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`What changed most since ${monthLabel(addMonths(month, -1))}?`}>
          {!s ? (
            <EmptyState title="Not recorded">No spending recorded for this month.</EmptyState>
          ) : !prevPoint ? (
            <EmptyState title="No comparison">{monthLabel(addMonths(month, -1))} has no data.</EmptyState>
          ) : changes.length === 0 ? (
            <p className="text-sm text-muted">No category changed.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-faint">
                <tr>
                  <th className="py-1 font-medium">Category</th>
                  <th className="py-1 text-right font-medium">Last month</th>
                  <th className="py-1 text-right font-medium">This month</th>
                  <th className="py-1 text-right font-medium">Change</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((c) => (
                  <tr key={c.category} className="border-t border-line/60">
                    <td className="py-1.5">{c.category}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted">{formatUSD(c.previousMinor)}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatUSD(c.currentMinor)}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {c.changeMinor > 0 ? "+" : "−"}
                      {formatUSD(Math.abs(c.changeMinor))} <span className="text-muted">({c.label})</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Large purchases">
          {large.length === 0 ? (
            <p className="text-sm text-muted">{v.kind === "summary" ? "Not available for an imported summary month." : "No large purchases this month."}</p>
          ) : (
            <ul className="divide-y divide-line/70 text-sm">
              {large.map((r) => (
                <li key={r.key} className="flex items-center justify-between gap-3 py-2">
                  <span>
                    {r.description} <span className="text-muted">· {r.date} · {r.category ?? "Needs category"}</span>
                  </span>
                  <span className="flex items-center gap-2 font-semibold tabular-nums">
                    <Badge tone="warn">Large</Badge>
                    {formatUSD(r.shareMinor)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
