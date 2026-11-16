"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/expenses", label: "Expenses" },
  { href: "/loan", label: "Loan" },
  { href: "/settings", label: "Settings" },
] as const;

export function Nav({ inboxCount = 0 }: { inboxCount?: number }) {
  const path = usePathname();
  // Inbox sits next to Expenses only while there is something to review (or while you are on it).
  const items = inboxCount > 0 || path.startsWith("/expenses/inbox") ? [ITEMS[0], { href: "/expenses/inbox", label: "Inbox" }, ITEMS[1], ITEMS[2]] : [...ITEMS];
  return (
    <nav aria-label="Main" className={`order-3 grid w-full gap-1 sm:order-2 sm:flex sm:w-auto ${items.length === 4 ? "grid-cols-4" : "grid-cols-3"}`}>
      {items.map((item) => {
        const active = item.href === "/expenses" ? path.startsWith("/expenses") && !path.startsWith("/expenses/inbox") : path === item.href || path.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex h-11 items-center justify-center rounded-xl px-4 text-sm font-medium transition ${
              active ? "bg-forest-700 text-white" : "text-muted hover:bg-forest-50 hover:text-brand-strong"
            }`}
          >
            {item.label}
            {item.href === "/expenses/inbox" && inboxCount > 0 && <span className="ml-1.5 rounded-full bg-warn-50 px-1.5 text-xs font-semibold text-warn">{inboxCount}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
