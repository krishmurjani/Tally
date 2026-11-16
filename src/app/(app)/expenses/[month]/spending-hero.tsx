import Link from "next/link";
import type { ReactNode } from "react";
import type { BudgetStatus } from "@/engines/budget";
import { addMonths, monthLabel } from "@/engines/dates";
import { formatUSD } from "@/engines/money";

export interface TopCategory {
  name: string;
  minor: number;
  dot: string;
}

const R = 50;
const C = 2 * Math.PI * R;

/** The month's headline: my share, how it sits against budget (ring), and the few numbers around it. */
export function SpendingHero({
  month,
  isCurrentMonth,
  totalMinor,
  budgetMinor,
  status,
  incomeMinor,
  leftOverMinor,
  changeMinor,
  previousMinor,
  top,
  closed = false,
  footer,
}: {
  month: string;
  isCurrentMonth: boolean;
  totalMinor: number;
  budgetMinor: number;
  status: BudgetStatus;
  incomeMinor: number | null;
  leftOverMinor: number | null;
  changeMinor: number | null;
  previousMinor: number | null;
  top: TopCategory[];
  /** Closed months show a Closed chip on the card. */
  closed?: boolean;
  /** Quiet row along the bottom (closed months: last synced + Reopen). */
  footer?: ReactNode;
}) {
  const pct = budgetMinor > 0 ? totalMinor / budgetMinor : null;
  // Within budget: mint. Past the budget line: the overspend arc in red. A ring can't show more than a full turn,
  // so at 133% the first 75% of the ring is "within budget" and the last 25% is the overspend.
  const within = pct === null ? 0 : pct <= 1 ? C * pct : C / pct;
  const over = pct !== null && pct > 1 ? C - within : 0;
  const chip =
    status.tone === "danger"
      ? "bg-danger-50 text-danger"
      : status.tone === "ok"
        ? "bg-white/15 text-[#d8e8dd]"
        : "bg-white/15 text-[#f7f5ef]";
  const previousName = monthLabel(addMonths(month, -1)).split(" ")[0];

  return (
    <section className={`relative rounded-3xl bg-hero p-5 text-[#f7f5ef] sm:p-8 ${closed ? "sm:pt-16" : ""}`}>
      {closed && (
        <span className="absolute right-4 top-4 inline-flex h-7 items-center gap-1.5 rounded-full bg-[#f6c453]/20 px-2.5 text-xs font-medium text-[#f7dc8a] ring-1 ring-[#f6c453]/35 sm:right-6 sm:top-5">
          <svg aria-hidden="true" viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4.5" y="9" width="11" height="7.5" rx="1.5" />
            <path d="M7 9V6.8a3 3 0 0 1 6 0V9" />
          </svg>
          Closed
        </span>
      )}
      <div className="flex flex-col gap-6 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-8">
        <div className="min-w-0 sm:flex-1 sm:basis-72">
          <p className="text-sm text-[#d8e8dd]/80">{isCurrentMonth ? "My share so far" : "My share of spending"}</p>
          <p className="mt-2 text-5xl font-bold leading-none tracking-tight tabular-nums sm:text-6xl">{formatUSD(totalMinor)}</p>
          <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-2 text-sm text-[#d8e8dd]">
            <span className={`rounded-md px-2 py-0.5 font-semibold ${chip}`}>{status.text.split(" · ")[0]}</span>
            {budgetMinor > 0 && <span>a {formatUSD(budgetMinor, { decimals: "auto" })} budget</span>}
          </p>
          {changeMinor !== null && changeMinor !== 0 && (
            <p className={`mt-2 inline-flex items-center gap-1.5 text-sm font-medium ${changeMinor > 0 ? "text-[#ffd0cb]" : "text-[#b9f0cf]"}`}>
              <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d={changeMinor < 0 ? "M10 4.5v11M5 11l5 5 5-5" : "M10 15.5v-11M5 9l5-5 5 5"} />
              </svg>
              {formatUSD(Math.abs(changeMinor))} {changeMinor > 0 ? "more" : "less"} than {previousName}
              {previousMinor !== null && <span className="font-normal text-[#d8e8dd]/70">({formatUSD(previousMinor)})</span>}
            </p>
          )}
          {changeMinor === null && <p className="mt-2 text-sm text-[#d8e8dd]/70">Previous month not recorded</p>}
        </div>

        <div className="flex items-center gap-6 sm:contents">
          <div role="img" aria-label={pct === null ? "No budget set" : `${Math.round(pct * 100)} percent of the budget spent`} className="relative size-36 shrink-0 sm:size-44">
            <svg viewBox="0 0 120 120" className="size-full -rotate-90">
              <circle cx="60" cy="60" r={R} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="12" />
              {within > 0 && <circle cx="60" cy="60" r={R} fill="none" stroke="#9fd8b1" strokeWidth="12" strokeLinecap="round" strokeDasharray={`${within} ${C}`} />}
              {over > 0 && <circle cx="60" cy="60" r={R} fill="none" stroke="#ff9a90" strokeWidth="12" strokeLinecap="round" strokeDasharray={`${over} ${C}`} strokeDashoffset={-within} />}
            </svg>
            <div className="absolute inset-0 grid place-items-center text-center">
              <div>
                <p className="text-3xl font-bold leading-none tracking-tight sm:text-4xl">{pct === null ? "—" : `${Math.round(pct * 100)}%`}</p>
                <p className="mt-1 text-xs text-[#d8e8dd]/80">{pct === null ? "no budget" : "of budget"}</p>
              </div>
            </div>
          </div>

          <dl className="flex min-w-0 flex-1 flex-col gap-4 text-sm sm:min-w-32 sm:flex-none">
            <div>
              <dt className="flex items-center gap-2 text-[#d8e8dd]/80">
                Income
                <Link href={`/expenses/${month}/income`} aria-label="Add income" title="Add income" className="grid size-6 place-items-center rounded-full border border-white/25 text-[#d8e8dd] transition hover:bg-white/10">
                  <svg aria-hidden="true" viewBox="0 0 20 20" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                    <path d="M10 4v12M4 10h12" />
                  </svg>
                </Link>
              </dt>
              <dd className={`mt-0.5 text-lg font-semibold ${incomeMinor === null ? "text-[#d8e8dd]/60" : ""}`}>{incomeMinor === null ? "Not recorded" : formatUSD(incomeMinor)}</dd>
            </div>
            <div>
              <dt className="text-[#d8e8dd]/80">Left over</dt>
              <dd className={`mt-0.5 text-lg font-semibold ${leftOverMinor === null ? "text-[#d8e8dd]/60" : leftOverMinor < 0 ? "text-[#ffd0cb]" : ""}`}>{leftOverMinor === null ? "Not recorded" : formatUSD(leftOverMinor)}</dd>
            </div>
          </dl>
        </div>
      </div>

      {top.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-white/15 pt-5">
          <span className="mr-1 text-sm text-[#d8e8dd]/80">Biggest besides rent:</span>
          {top.map((t) => (
            <span key={t.name} className="inline-flex h-8 items-center gap-2 rounded-full bg-white/10 px-3 text-sm font-medium">
              <span aria-hidden="true" className="size-2 rounded-full" style={{ background: t.dot }} />
              {t.name} {formatUSD(t.minor, { decimals: "never" })}
            </span>
          ))}
        </div>
      )}
      {footer && <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-white/15 pt-4 text-sm text-[#d8e8dd]">{footer}</div>}
    </section>
  );
}
