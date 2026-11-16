import Link from "next/link";
import { addMonths, monthLabel, type MonthKey } from "@/engines/dates";

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={dir === "left" ? "M12 5.5L7.5 10l4.5 4.5" : "M8 5.5L12.5 10 8 14.5"} />
    </svg>
  );
}

/** Always-visible month picker for the Expenses section: arrows, the month with a one-line status caption, and a jump back to this month. */
export function MonthPicker({ month, basePath, current, suffix = "", caption }: { month: MonthKey; basePath: string; current: MonthKey; suffix?: string; caption?: { text: string; strong?: boolean } }) {
  const prev = addMonths(month, -1);
  const next = addMonths(month, 1);
  const btn = "inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-ink transition hover:bg-forest-50";
  return (
    <div className="flex w-full items-center gap-2 sm:w-auto" role="group" aria-label="Choose month">
      <Link href={`${basePath}/${prev}${suffix}`} className={btn} aria-label={`Previous month, ${monthLabel(prev)}`}>
        <Chevron dir="left" />
      </Link>
      <div className="min-w-0 flex-1 text-center sm:min-w-44 sm:flex-none">
        <h1 className="text-xl font-semibold leading-tight">{monthLabel(month)}</h1>
        {caption && <p className={`text-xs ${caption.strong ? "font-medium text-brand" : "text-muted"}`}>{caption.text}</p>}
      </div>
      <Link href={`${basePath}/${next}${suffix}`} className={btn} aria-label={`Next month, ${monthLabel(next)}`}>
        <Chevron dir="right" />
      </Link>
      {month !== current && (
        <Link href={`${basePath}/${current}${suffix}`} className={`${btn} gap-2 sm:w-auto sm:px-4 sm:ml-1`} aria-label="Jump to this month" title="Jump to this month">
          <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3.5" y="4.5" width="13" height="12" rx="2.2" />
            <path d="M3.5 8.5h13M7 3v3M13 3v3" />
            <circle cx="10" cy="12.5" r="1.3" fill="currentColor" stroke="none" />
          </svg>
          <span className="hidden text-sm font-medium sm:inline">This month</span>
        </Link>
      )}
    </div>
  );
}
