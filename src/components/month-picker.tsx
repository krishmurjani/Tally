import Link from "next/link";
import type { ReactNode } from "react";
import { addMonths, monthLabel, type MonthKey } from "@/engines/dates";

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={dir === "left" ? "M12 5.5L7.5 10l4.5 4.5" : "M8 5.5L12.5 10 8 14.5"} />
    </svg>
  );
}

/** Always-visible month picker for the Expenses section. */
export function MonthPicker({ month, basePath, current, suffix = "", badge }: { month: MonthKey; basePath: string; current: MonthKey; suffix?: string; badge?: ReactNode }) {
  const prev = addMonths(month, -1);
  const next = addMonths(month, 1);
  const btn = "inline-flex size-11 items-center justify-center rounded-xl border border-line bg-surface text-ink transition hover:bg-forest-50";
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Choose month">
      <div className="flex w-full items-center gap-2 sm:w-auto">
        <Link href={`${basePath}/${prev}${suffix}`} className={btn} aria-label={`Previous month, ${monthLabel(prev)}`}>
          <Chevron dir="left" />
        </Link>
        <h1 className="min-w-0 flex-1 text-center text-xl font-semibold sm:min-w-40 sm:flex-none">{monthLabel(month)}</h1>
        <Link href={`${basePath}/${next}${suffix}`} className={btn} aria-label={`Next month, ${monthLabel(next)}`}>
          <Chevron dir="right" />
        </Link>
      </div>
      {badge}
      {month !== current && (
        <Link href={`${basePath}/${current}${suffix}`} className="inline-flex h-11 items-center rounded-xl border border-line bg-surface px-4 text-sm font-medium transition hover:bg-forest-50 sm:ml-1">
          This month
        </Link>
      )}
    </div>
  );
}
