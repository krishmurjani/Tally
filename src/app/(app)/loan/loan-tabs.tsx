"use client";

import { usePathname } from "next/navigation";
import { TabBar } from "@/components/tab-bar";

const TABS = [
  { href: "/loan", label: "Overview" },
  { href: "/loan/planner", label: "Payoff planner" },
  { href: "/loan/payments", label: "Lender payments" },
  { href: "/loan/sister", label: "Sister" },
];

export function LoanTabs() {
  const path = usePathname();
  const active = TABS.find((t) => (t.href === "/loan" ? path === "/loan" : path.startsWith(t.href)))?.href ?? "";
  return (
    <TabBar
      ariaLabel="Loan views"
      storageKey="loan-views"
      activeKey={active}
      items={TABS.map((t) => ({ key: t.href, href: t.href, label: t.label }))}
      className="grid w-full grid-cols-2 gap-1 rounded-xl border border-line bg-surface p-1 text-sm sm:flex sm:w-auto"
      itemClass="flex h-9 items-center justify-center rounded-lg px-3"
      activeClass="font-medium text-brand-strong"
      inactiveClass="text-muted hover:text-brand-strong"
      pillClass="rounded-lg"
      pillColor="var(--color-forest-50)"
    />
  );
}
