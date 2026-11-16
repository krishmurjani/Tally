"use client";

import { useEffect, useState, type ReactNode } from "react";
import { formatUSD } from "@/engines/money";
import { categoryTone } from "@/lib/category-colors";

export interface CategoryRow {
  name: string;
  actualMinor: number;
  budgetMinor: number;
  statusText: string;
  /** "over" is the only state shown in red, and it always comes with text. */
  over: boolean;
}

type View = "list" | "cards";
const KEY = "tally.categoryView";

function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const opts: [View, string, ReactNode][] = [
    [
      "list",
      "List",
      <svg key="l" aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M4 6h12M4 10h12M4 14h12" />
      </svg>,
    ],
    [
      "cards",
      "Cards",
      <svg key="c" aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
        <rect x="3.5" y="3.5" width="5.5" height="5.5" rx="1.2" />
        <rect x="11" y="3.5" width="5.5" height="5.5" rx="1.2" />
        <rect x="3.5" y="11" width="5.5" height="5.5" rx="1.2" />
        <rect x="11" y="11" width="5.5" height="5.5" rx="1.2" />
      </svg>,
    ],
  ];
  return (
    <div role="radiogroup" aria-label="View categories as" className="relative grid h-10 grid-cols-2 rounded-xl border border-line bg-surface p-1 text-sm">
      <span
        aria-hidden="true"
        className="absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-lg bg-forest-700 shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.34,1.3,0.5,1)] motion-reduce:transition-none"
        style={{ transform: view === "list" ? "translateX(0)" : "translateX(100%)" }}
      />
      {opts.map(([value, label, icon]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={view === value}
          onClick={() => onChange(value)}
          className={`relative z-10 inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 font-medium transition-colors duration-200 ${view === value ? "text-white" : "text-muted hover:text-brand-strong"}`}
        >
          {icon}
          {label}
        </button>
      ))}
    </div>
  );
}

export function CategoryBreakdown({ rows, order, sourceLabel, editor }: { rows: CategoryRow[]; order: string[]; sourceLabel: string; editor?: ReactNode }) {
  const [view, setView] = useState<View>("list");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === "list" || saved === "cards") setView(saved);
    } catch {
      /* storage unavailable: stay on the list */
    }
  }, []);
  const choose = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(KEY, v);
    } catch {
      /* ignore */
    }
  };
  const pctOf = (r: CategoryRow) => (r.budgetMinor > 0 ? Math.min(100, Math.round((r.actualMinor / r.budgetMinor) * 100)) : r.actualMinor > 0 ? 100 : 0);

  return (
    <section className="rounded-card border border-line bg-surface p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div>
          <h2 className="text-base font-semibold">By category</h2>
          <p className="text-xs text-faint">{sourceLabel}</p>
        </div>
        <div className="flex items-center gap-3">
          {editor}
          <ViewToggle view={view} onChange={choose} />
        </div>
      </div>

      {view === "list" ? (
        <ul>
          {rows.map((r) => {
            const tone = categoryTone(r.name, order);
            return (
              <li key={r.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 border-t border-line/60 py-2.5 text-sm sm:grid-cols-[11rem_minmax(0,1fr)_13rem]">
                <span className="flex min-w-0 items-center gap-2 font-medium">
                  <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: tone.dot }} />
                  <span className="truncate">{r.name}</span>
                </span>
                <span aria-hidden="true" className="order-last col-span-2 h-2 overflow-hidden rounded-full bg-canvas sm:order-none sm:col-span-1">
                  <span className="block h-full rounded-full" style={{ width: `${pctOf(r)}%`, background: r.over ? "var(--color-danger)" : tone.bar }} />
                </span>
                <span className="text-right tabular-nums">
                  <b>{formatUSD(r.actualMinor)}</b> <span className={`text-xs ${r.over ? "font-medium text-danger" : "text-muted"}`}>{r.statusText}</span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {rows.map((r) => {
            const tone = categoryTone(r.name, order);
            return (
              <li key={r.name} className="flex min-w-0 flex-col gap-2 rounded-2xl p-3.5 sm:p-4" style={{ background: tone.background, border: `1px solid ${tone.border}`, color: tone.color }}>
                <span className="truncate text-sm font-semibold">{r.name}</span>
                <span className="text-xl font-bold tracking-tight tabular-nums sm:text-2xl">{formatUSD(r.actualMinor)}</span>
                <span aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-canvas/60">
                  <span className="block h-full rounded-full" style={{ width: `${pctOf(r)}%`, background: r.over ? "var(--color-danger)" : tone.bar }} />
                </span>
                <span className={`text-xs ${r.over ? "font-semibold text-danger" : ""}`} style={r.over ? undefined : { opacity: 0.8 }}>
                  {r.statusText}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
