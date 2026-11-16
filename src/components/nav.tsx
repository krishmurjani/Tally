"use client";

import { usePathname } from "next/navigation";
import { TabBar, type TabItem } from "./tab-bar";

const ITEMS = [
  { href: "/expenses", label: "Expenses" },
  { href: "/loan", label: "Loan" },
  { href: "/settings", label: "Settings" },
] as const;

export function Nav({ inboxCount = 0 }: { inboxCount?: number }) {
  const path = usePathname();
  // Inbox sits next to Expenses only while there is something to review (or while you are on it).
  const items = inboxCount > 0 || path.startsWith("/expenses/inbox") ? [ITEMS[0], { href: "/expenses/inbox", label: "Inbox" }, ITEMS[1], ITEMS[2]] : [...ITEMS];
  const isActive = (href: string) => (href === "/expenses" ? path.startsWith("/expenses") && !path.startsWith("/expenses/inbox") : path === href || path.startsWith(`${href}/`));
  const tabs: TabItem[] = items.map((i) => ({
    key: i.href,
    href: i.href,
    label: i.label,
    badge: i.href === "/expenses/inbox" && inboxCount > 0 ? <span className="ml-1.5 rounded-full bg-warn-50 px-1.5 text-xs font-semibold text-warn">{inboxCount}</span> : undefined,
  }));
  return (
    <TabBar
      ariaLabel="Main"
      storageKey="main-nav"
      activeKey={items.find((i) => isActive(i.href))?.href ?? ""}
      items={tabs}
      className={`order-3 grid w-full gap-1 sm:order-2 sm:flex sm:w-auto ${items.length === 4 ? "grid-cols-4" : "grid-cols-3"}`}
      itemClass="flex h-11 items-center justify-center rounded-xl px-4 text-sm font-medium"
      activeClass="text-white"
      inactiveClass="text-muted hover:bg-forest-50 hover:text-brand-strong"
      pillClass="rounded-xl"
      pillColor="var(--color-forest-700)"
    />
  );
}
