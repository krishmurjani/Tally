import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isMonthKey, monthLabel } from "@/engines/dates";
import { formatUSD } from "@/engines/money";
import { BudgetText, Usd } from "@/components/money";
import { MonthHeader } from "@/components/month-header";
import { Badge, Card, EmptyState, Stat } from "@/components/ui";
import { requireOwnerOrRedirect } from "@/server/auth-guard";
import { getDb } from "@/server/db/client";
import { loadMonthView } from "@/server/month-data";
import { budgetForMonth } from "@/server/repos/budgets";
import { BudgetEditor } from "./budget-editor";
import { AddExpenseButton } from "./expense-form";
import { NeedsAttention } from "./needs-attention";
import { NewCategoryProvider } from "./new-category";
import { btnSecondary, ChangesBanner, CloseMonthButton, ReopenMonthButton, SourceSwitch, StatusChip, SyncButton } from "./toolbar";
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
  const actuals = s && v.kind !== "none" ? Object.fromEntries(s.byCategory.map((c) => [c.category, c.actualMinor])) : null;

  return (
    <NewCategoryProvider month={month} closed={closed}>
    <div className="space-y-6">
      <MonthHeader month={month} tab="spending" badge={<StatusChip closed={closed} monthToDate={v.isCurrentMonth} />} />

      <section aria-label="Month actions" className="rounded-card border border-line bg-surface p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {!closed && <SourceSwitch month={month} source={v.dataSource} />}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {v.dataSource !== "csv" && !closed && <SyncButton month={month} />}
            {v.dataSource === "csv" && !closed && (
              <Link href="/expenses/import" className={btnSecondary}>
                Import CSV files
              </Link>
            )}
            {!closed && <AddExpenseButton month={month} categories={cats} />}
            {!closed && v.hasData && <CloseMonthButton month={month} version={v.version} blockers={blockers} />}
            {closed && v.version && <ReopenMonthButton month={month} version={v.version} />}
          </div>
        </div>
        {v.lastSyncAt && v.dataSource === "api" && (
          <p className="mt-2 text-xs text-faint">Last synced {v.lastSyncAt.toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" })}</p>
        )}
      </section>

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
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <Stat label={v.isCurrentMonth ? "Spent so far" : "Spent"} value={<Usd minor={s.totalMinor} />} hint={<BudgetText status={s.budgetStatus} />} />
            </Card>
            <Card>
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm text-muted">Income</p>
                <Link
                  href={`/expenses/${month}/income`}
                  aria-label="Add income"
                  title="Add income"
                  className="-mr-1.5 -mt-1.5 grid size-9 place-items-center rounded-full border border-line bg-surface text-forest-700 transition hover:bg-forest-50"
                >
                  <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M10 4.5v11M4.5 10h11" />
                  </svg>
                </Link>
              </div>
              <p className={`mt-1 text-2xl font-semibold tracking-tight ${income === null ? "text-faint" : ""}`}>{income === null ? "Not recorded" : <Usd minor={income} />}</p>
              <p className="mt-1 text-sm text-muted">
                {paychecks > 0 && (
                  <Link href={`/expenses/${month}/income`} className="font-medium text-forest-700 hover:underline">
                    {paychecks} entr{paychecks === 1 ? "y" : "ies"} · view
                  </Link>
                )}
              </p>
            </Card>
            <Card>
              <Stat
                label="Left over"
                value={s.leftOverMinor === null ? "Not recorded" : <Usd minor={s.leftOverMinor} className={s.leftOverMinor < 0 ? "text-danger" : ""} />}
                hint={s.leftOverMinor === null ? "Needs income" : s.leftOverMinor < 0 ? "Spent more than income" : "Income − expenses"}
              />
            </Card>
            <Card>
              <Stat
                label="vs previous month"
                value={
                  change === null ? (
                    <span className="text-faint">No data</span>
                  ) : change === 0 ? (
                    "No change"
                  ) : (
                    <span className={`inline-flex items-center gap-1.5 ${change < 0 ? "text-forest-700" : "text-danger"}`}>
                      <svg aria-hidden="true" viewBox="0 0 20 20" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d={change < 0 ? "M10 4.5v11M5 11l5 5 5-5" : "M10 15.5v-11M5 9l5-5 5 5"} />
                      </svg>
                      {formatUSD(Math.abs(change))}
                    </span>
                  )
                }
                hint={
                  s.previousTotalMinor === null ? (
                    "Previous month not recorded"
                  ) : (
                    <span>
                      {change !== null && change !== 0 && <span className={change < 0 ? "font-medium text-forest-700" : "font-medium text-danger"}>{change < 0 ? "Spent less" : "Spent more"} · </span>}
                      {formatUSD(s.previousTotalMinor)} last month
                    </span>
                  )
                }
              />
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
            <Card title={`Needs attention${blockers ? ` · ${blockers}` : ""}`}>
              {v.kind === "summary" ? (
                <p className="text-sm text-muted">Nothing to review — this month is an imported summary.</p>
              ) : (
                <NeedsAttention rows={v.rows} pendingDecisions={v.pendingDecisions} categories={cats} month={month} closed={closed} />
              )}
            </Card>
            <Card
              title="By category"
              action={
                <span className="flex items-center gap-2 text-xs text-faint">
                  {v.budgetSource === "default" ? "Default budget" : v.budgetSource === "snapshot" ? "Budget at close" : "This month's budget"}
                  {!closed && <BudgetEditor month={month} categories={cats} amounts={budget.amounts} actuals={actuals} source={budget.source} />}
                </span>
              }
            >
              <ul className="space-y-3">
                {s.byCategory.map((c) => {
                  const pct = c.budgetMinor > 0 ? Math.min(100, Math.round((c.actualMinor / c.budgetMinor) * 100)) : c.actualMinor > 0 ? 100 : 0;
                  return (
                    <li key={c.category}>
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="font-medium">{c.category}</span>
                        <span className="tabular-nums">
                          <Usd minor={c.actualMinor} /> <span className="text-faint">/ {formatUSD(c.budgetMinor, { decimals: "auto" })}</span>
                        </span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-canvas" aria-hidden>
                        <div className={`h-full rounded-full ${c.status.tone === "danger" ? "bg-danger" : "bg-forest-600"}`} style={{ width: `${pct}%` }} />
                      </div>
                      <BudgetText status={c.status} />
                    </li>
                  );
                })}
              </ul>
            </Card>
          </div>

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
