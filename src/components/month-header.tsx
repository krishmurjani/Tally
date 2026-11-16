import type { ReactNode } from "react";
import { currentMonthNY, type MonthKey } from "@/engines/dates";
import { MonthPicker } from "./month-picker";
import { TabBar } from "./tab-bar";

const TABS = [
  { key: "spending", label: "Spending", suffix: "" },
  { key: "income", label: "Income", suffix: "/income" },
  { key: "insights", label: "Insights", suffix: "/insights" },
] as const;

/** Month picker (always visible in Expenses) + the Spending / Income / Insights tabs. */
export function MonthHeader({ month, tab, caption }: { month: MonthKey; tab: (typeof TABS)[number]["key"]; caption?: { text: string; strong?: boolean } }) {
  const suffix = TABS.find((t) => t.key === tab)!.suffix;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <MonthPicker month={month} basePath="/expenses" current={currentMonthNY()} suffix={suffix} caption={caption} />
      <TabBar
        ariaLabel="Expenses views"
        storageKey="expenses-views"
        activeKey={tab}
        items={TABS.map((t) => ({ key: t.key, href: `/expenses/${month}${t.suffix}`, label: t.label }))}
        className="grid w-full grid-cols-3 gap-1 rounded-xl border border-line bg-surface p-1 text-sm sm:flex sm:w-auto"
        itemClass="flex h-9 items-center justify-center rounded-lg px-3"
        activeClass="font-medium text-brand-strong"
        inactiveClass="text-muted hover:text-brand-strong"
        pillClass="rounded-lg"
        pillColor="var(--color-forest-50)"
      />
    </div>
  );
}
