"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/expenses", label: "Expenses" },
  { href: "/loan", label: "Loan" },
  { href: "/settings", label: "Settings" },
] as const;

export function Nav() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="order-3 grid w-full grid-cols-3 gap-1 sm:order-2 sm:flex sm:w-auto">
      {ITEMS.map((item) => {
        const active = path === item.href || path.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex h-11 items-center justify-center rounded-xl px-4 text-sm font-medium transition ${
              active ? "bg-forest-700 text-white" : "text-muted hover:bg-forest-50 hover:text-forest-800"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
