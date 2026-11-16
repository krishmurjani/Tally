"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/loan", label: "Overview" },
  { href: "/loan/planner", label: "Payoff planner" },
  { href: "/loan/payments", label: "Lender payments" },
  { href: "/loan/sister", label: "Sister" },
];

export function LoanTabs() {
  const path = usePathname();
  return (
    <nav className="grid w-full grid-cols-2 gap-1 rounded-xl border border-line bg-surface p-1 text-sm sm:flex sm:w-auto" aria-label="Loan views">
      {TABS.map((t) => {
        const active = t.href === "/loan" ? path === "/loan" : path.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined} className={`flex h-9 items-center justify-center rounded-lg px-3 ${active ? "bg-forest-50 font-medium text-forest-800" : "text-muted hover:text-forest-800"}`}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
