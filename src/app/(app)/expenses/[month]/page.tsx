import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isMonthKey, monthLabel } from "@/engines/dates";
import { MonthHeader } from "@/components/month-header";
import { Card, EmptyState } from "@/components/ui";
import { categoryTone } from "@/lib/category-colors";
import { requireOwnerOrRedirect } from "@/server/auth-guard";
import { getDb } from "@/server/db/client";
import { loadMonthView } from "@/server/month-data";
import { budgetForMonth } from "@/server/repos/budgets";
import { BudgetEditor } from "./budget-editor";
import { CategoryBreakdown } from "./category-breakdown";
import { AddExpenseButton } from "./expense-form";
import { NeedsAttention } from "./needs-attention";
import { NewCategoryProvider } from "./new-category";
import { SpendingHero } from "./spending-hero";
import { btnSecondary, ChangesBanner, CloseMonthButton, ReopenMonthButton, SourceSwitch, SyncButton } from "./toolbar";
import { Transactions } from "./transactions";

export async function generateMetadata({ params }: { params: Promise<{ month: string }> }): Promise<Metadata> {
  const { month } = await params;
  return { title: isMonthKey(month) ? monthLabel(month) : "Expenses" };
}

export default async function MonthPage({ params }: { params: Promise<{ month: string }> }) {
  const owner = await requireOwnerOrRedirect();
  const { month } = await params;
  if (!isMonthKey(month)) notFound();
  const db = getDb();
  const [v, budget] = await Promise.all([loadMonthView(db, owner, month), budgetForMonth(db, owner, month)]);
  const closed = v.status === "closed";
  const cats = v.categories.map((c) => ({ id: c.id, name: c.name }));
  const s = v.summary;
  const blockers = (s?.counts.review ?? 0) + (s?.counts.needsCategory ?? 0);
  const change = s?.changeVsPreviousMinor ?? null;
  const income = v.income.totalMinor;
  const paychecks = v.income.entries.length;
  const order = v.categories.map((c) => c.name);
  const attention = v.rows.filter((r) => r.status === "review" || r.flags.includes("needs_category") || r.flags.includes("large")).length + v.pendingDecisions.length;
  const actuals = s && v.kind !== "none" ? Object.fromEntries(s.byCategory.map((c) => [c.category, c.actualMinor])) : null;

  return (
    <NewCategoryProvider month={month} closed={closed}>
    <div className="space-y-6">
      <MonthHeader month={month} tab="spending" caption={closed ? { text: "Closed · snapshot", strong: true } : { text: v.isCurrentMonth ? "Open · month to date" : "Open" }} />

      {(!closed || !s) && (
      <section aria-label="Month actions" className="rounded-card border border-line bg-surface p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="w-full sm:w-auto">{!closed && <SourceSwitch month={month} source={v.dataSource} />}</div>
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
            {v.dataSource !== "csv" && !closed && <SyncButton month={month} />}
            {v.dataSource === "csv" && !closed && (
              <Link href="/expenses/import" className={`${btnSecondary} col-span-2 sm:col-span-1`}>
                Import CSV files
              </Link>
            )}
            {!closed && <AddExpenseButton month={month} categories={cats} />}
            {!closed && v.hasData && <CloseMonthButton month={month} version={v.version} blockers={blockers} />}
            {closed && !s && v.version && <ReopenMonthButton month={month} version={v.version} />}
          </div>
        </div>
        {v.lastSyncAt && v.dataSource === "api" && (
          <p className="mt-2 text-xs text-faint">Last synced {v.lastSyncAt.toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" })}</p>
        )}
      </section>
      )}

      {closed && v.pendingChanges && v.version && <ChangesBanner month={month} version={v.version} diff={v.pendingChanges} />}

      {v.csv && v.csv.partial.length > 0 && (
        <p className="rounded-xl border border-warn/30 bg-warn-50 px-4 py-3 text-sm text-warn">
          Partial data: {v.csv.partial.map((p) => `${p.fileName} ends ${p.lastDate}`).join(", ")}. Totals cover only what those exports contain.
        </p>
      )}
      {v.csv && v.csv.problems.length > 0 && (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger-50 px-4 py-3 text-sm text-danger">
          {v.csv.problems.length} CSV row(s) couldn&apos;t be read and are not counted: {v.csv.problems.map((p) => `${p.fileName}:${p.line} (${p.message})`).join("; ")}
        </p>
      )}

      {v.kind === "summary" && (
        <p className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-muted">
          Imported monthly summary — category totals only, no transactions. Syncing or importing detailed data for this month replaces it.
        </p>
      )}

      {!s ? (
        <Card title="My spending">
          <EmptyState title="Not recorded">
            Sync this month from Splitwise, switch it to a CSV import, or add an expense by hand.
          </EmptyState>
        </Card>
      ) : (
        <>
          <SpendingHero
            month={month}
            isCurrentMonth={v.isCurrentMonth}
            totalMinor={s.totalMinor}
            budgetMinor={s.budgetTotalMinor}
            status={s.budgetStatus}
            incomeMinor={income}
            leftOverMinor={s.leftOverMinor}
            changeMinor={change}
            previousMinor={s.previousTotalMinor}
            closed={closed}
            footer={
              closed && (
                <>
                  <span>{v.lastSyncAt && v.dataSource === "api" ? `Last synced ${v.lastSyncAt.toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" })}` : "Frozen snapshot"}</span>
                  {v.version && <ReopenMonthButton month={month} version={v.version} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/25 bg-white/10 px-4 text-sm font-medium text-[#f7f5ef] transition hover:bg-white/20" />}
                </>
              )
            }
            top={[...s.byCategory]
              .filter((c) => c.actualMinor > 0)
              .sort((x, y) => y.actualMinor - x.actualMinor)
              .slice(0, 3)
              .map((c) => ({ name: c.category, minor: c.actualMinor, dot: categoryTone(c.category, order).dot }))}
          />

          {attention === 0 ? (
            <section aria-label="Needs attention" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-card border border-line bg-surface px-4 py-3.5 text-sm sm:px-5">
              <span className="font-semibold">Needs attention</span>
              <span className="text-brand">{v.kind === "summary" ? "Nothing to review — imported summary" : "Nothing to review"}</span>
            </section>
          ) : (
            <Card title={`Needs attention · ${attention}`}>
              <NeedsAttention rows={v.rows} pendingDecisions={v.pendingDecisions} categories={cats} month={month} closed={closed} />
            </Card>
          )}

          <CategoryBreakdown
            order={order}
            sourceLabel={v.budgetSource === "default" ? "Default budget" : v.budgetSource === "snapshot" ? "Budget at close" : "This month's budget"}
            editor={!closed ? <BudgetEditor month={month} categories={cats} amounts={budget.amounts} actuals={actuals} source={budget.source} /> : undefined}
            rows={s.byCategory.map((c) => ({ name: c.category, actualMinor: c.actualMinor, budgetMinor: c.budgetMinor, statusText: c.status.text.split(" · ")[0]!, over: c.status.kind === "over" }))}
          />

          {v.kind === "detailed" && (
            <Card title="Transactions">
              <Transactions rows={v.rows} categories={cats} month={month} closed={closed} />
            </Card>
          )}
        </>
      )}
    </div>
    </NewCategoryProvider>
  );
}
