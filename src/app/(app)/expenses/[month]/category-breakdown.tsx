"use client";

import { useEffect, useState, type ReactNode } from "react";
import { SaveStatus } from "@/components/save-status";
import { budgetStatus } from "@/engines/budget";
import { monthLabel } from "@/engines/dates";
import { formatUSD } from "@/engines/money";
import { categoryTone } from "@/lib/category-colors";
import { BudgetDrawer, useBudgetDraft, type BudgetEditorProps } from "./budget-editor";

export interface CategoryRow {
  id: string | null;
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

const editBtn = "inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-medium transition hover:bg-forest-50";

export function CategoryBreakdown({ rows, order, sourceLabel, budget }: { rows: CategoryRow[]; order: string[]; sourceLabel: string; budget?: BudgetEditorProps }) {
  const [view, setView] = useState<View>("list");
  const [drawer, setDrawer] = useState(false);
  const [editing, setEditing] = useState(false);
  const draft = useBudgetDraft(budget ?? { month: "", categories: [], amounts: {} });
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
    if (editing) {
      setEditing(false);
      draft.reset();
    }
    try {
      localStorage.setItem(KEY, v);
    } catch {
      /* ignore */
    }
  };
  const pctOf = (r: CategoryRow) => (r.budgetMinor > 0 ? Math.min(100, Math.round((r.actualMinor / r.budgetMinor) * 100)) : r.actualMinor > 0 ? 100 : 0);
  const finishEdit = () => {
    setEditing(false);
    draft.reset();
  };

  return (
    <section className="rounded-card border border-line bg-surface p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div>
          <h2 className="text-base font-semibold">By category</h2>
          <p className="text-xs text-faint">{sourceLabel}</p>
        </div>
        <div className="flex items-center gap-3">
          {budget && !editing && (
            <button type="button" onClick={() => (view === "cards" ? setEditing(true) : setDrawer(true))} className={editBtn}>
              <svg aria-hidden="true" viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12.5 4.5l3 3L7 16H4v-3z" />
              </svg>
              Edit budget
            </button>
          )}
          <ViewToggle view={view} onChange={choose} />
        </div>
      </div>

      {budget && editing && view === "cards" && (
        <div className="mb-4 rounded-2xl border border-forest-600/40 bg-forest-50 p-3 sm:p-4">
          <p className="text-sm font-medium">
            Editing budget · total {formatUSD(draft.total)}
            <span className="ml-2 font-normal text-muted">Tap a budget number on any card to change it. Cards update as you type.</span>
          </p>
          {draft.invalid.length > 0 && <p className="mt-1 text-sm text-danger">Fix: {draft.invalid.map((c) => c.name).join(", ")} (amounts like 100 or 100.50, not negative).</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              disabled={draft.save.pending || draft.invalid.length > 0}
              onClick={async () => {
                if (await draft.submit("month")) setEditing(false);
              }}
              className="h-10 rounded-xl bg-forest-700 px-4 text-sm font-medium text-white transition hover:bg-forest-800 disabled:opacity-60"
            >
              Save for {monthLabel(budget.month)} only
            </button>
            <button
              disabled={draft.save.pending || draft.invalid.length > 0}
              onClick={async () => {
                if (await draft.submit("default")) setEditing(false);
              }}
              className="h-10 rounded-xl border border-line bg-surface px-4 text-sm font-medium transition hover:bg-forest-50 disabled:opacity-60"
            >
              Save as default from {monthLabel(budget.month, "short")} on
            </button>
            <button disabled={draft.copy.pending} onClick={draft.copyPrevious} className="h-10 rounded-xl border border-line bg-surface px-4 text-sm transition hover:bg-forest-50">
              Copy last month
            </button>
            <button onClick={finishEdit} className="h-10 rounded-xl px-3 text-sm text-muted transition hover:text-ink">
              Cancel
            </button>
            <SaveStatus state={draft.save.state.kind === "saved" ? { kind: "idle" } : draft.save.state} />
          </div>
        </div>
      )}

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
            const inline = editing && budget && r.id !== null;
            // While editing, the card follows the number being typed.
            const draftBudget = inline ? (draft.parsed[r.id!] ?? r.budgetMinor) : r.budgetMinor;
            const live = inline ? budgetStatus(r.actualMinor, draftBudget) : null;
            const over = inline ? live!.tone === "danger" : r.over;
            const text = inline ? live!.text.split(" · ")[0]! : r.statusText;
            const pct = draftBudget > 0 ? Math.min(100, Math.round((r.actualMinor / draftBudget) * 100)) : r.actualMinor > 0 ? 100 : 0;
            return (
              <li key={r.name} className="flex min-w-0 flex-col gap-2 rounded-2xl p-3.5 sm:p-4" style={{ background: tone.background, border: `1px solid ${tone.border}`, color: tone.color }}>
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-semibold">{r.name}</span>
                  {inline && <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide opacity-70">Budget</span>}
                </span>
                {inline ? (
                  // While editing, the big number is the budget itself and is typed over in place.
                  <label
                    className={`-mx-1 inline-flex cursor-text items-baseline self-start rounded-t-md border-b-2 border-dashed px-1 text-xl font-bold tracking-tight tabular-nums transition focus-within:bg-white/15 focus-within:[border-bottom-style:solid] sm:text-2xl ${draft.parsed[r.id!] === null ? "border-danger" : "[border-color:color-mix(in_srgb,currentColor_50%,transparent)]"}`}
                  >
                    <span aria-hidden="true">$</span>
                    <input
                      inputMode="decimal"
                      aria-label={`${r.name} budget`}
                      value={draft.values[r.id!] ?? ""}
                      onChange={(e) => draft.setValues((v) => ({ ...v, [r.id!]: e.target.value }))}
                      onFocus={(e) => e.currentTarget.select()}
                      style={{ width: `${Math.max(2, (draft.values[r.id!] ?? "").length + 0.6)}ch`, outline: "none" }}
                      className="min-w-0 bg-transparent text-inherit"
                    />
                  </label>
                ) : (
                  <span className="text-xl font-bold tracking-tight tabular-nums sm:text-2xl">{formatUSD(r.actualMinor)}</span>
                )}
                <span aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-canvas/60">
                  <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: over ? "var(--color-danger)" : tone.bar }} />
                </span>
                <span className={`text-xs ${over ? "font-semibold text-danger" : ""}`} style={over ? undefined : { opacity: 0.8 }}>
                  {inline ? `Spent ${formatUSD(r.actualMinor)} · ${text}` : text}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {budget && <BudgetDrawer open={drawer} onClose={() => setDrawer(false)} draft={draft} {...budget} />}
    </section>
  );
}
