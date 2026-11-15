import Link from "next/link";
import { currentMonthNY, type MonthKey } from "@/engines/dates";
import { MonthPicker } from "./month-picker";

const TABS = [
  { key: "spending", label: "Spending", suffix: "" },
  { key: "income", label: "Income", suffix: "/income" },
  { key: "insights", label: "Insights", suffix: "/insights" },
] as const;

/** Month picker (always visible in Expenses) + the Spending / Income / Insights tabs. */
export function MonthHeader({ month, tab }: { month: MonthKey; tab: (typeof TABS)[number]["key"] }) {
  const suffix = TABS.find((t) => t.key === tab)!.suffix;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <MonthPicker month={month} basePath="/expenses" current={currentMonthNY()} suffix={suffix} />
      <nav className="flex gap-1 rounded-xl border border-line bg-surface p-1 text-sm" aria-label="Expenses views">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/expenses/${month}${t.suffix}`}
            aria-current={t.key === tab ? "page" : undefined}
            className={`flex h-9 items-center rounded-lg px-3 ${t.key === tab ? "bg-forest-50 font-medium text-forest-800" : "text-muted hover:text-forest-800"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
