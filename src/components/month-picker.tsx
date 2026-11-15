import Link from "next/link";
import { addMonths, monthLabel, type MonthKey } from "@/engines/dates";

/** Always-visible month picker for the Expenses section. */
export function MonthPicker({ month, basePath, current, suffix = "" }: { month: MonthKey; basePath: string; current: MonthKey; suffix?: string }) {
  const prev = addMonths(month, -1);
  const next = addMonths(month, 1);
  const btn = "grid size-11 place-items-center rounded-xl border border-line bg-surface text-lg hover:bg-forest-50";
  return (
    <div className="flex items-center gap-2" role="group" aria-label="Choose month">
      <Link href={`${basePath}/${prev}${suffix}`} className={btn} aria-label={`Previous month, ${monthLabel(prev)}`}>
        ‹
      </Link>
      <h1 className="min-w-40 text-center text-xl font-semibold">{monthLabel(month)}</h1>
      <Link href={`${basePath}/${next}${suffix}`} className={btn} aria-label={`Next month, ${monthLabel(next)}`}>
        ›
      </Link>
      {month !== current && (
        <Link href={`${basePath}/${current}${suffix}`} className="ml-1 text-sm font-medium text-forest-700 underline-offset-4 hover:underline">
          This month
        </Link>
      )}
    </div>
  );
}
