"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Drawer } from "@/components/drawer";
import { Usd } from "@/components/money";
import { SaveStatus } from "@/components/save-status";
import { MultiSelect, Popover, Select } from "@/components/select";
import { Badge } from "@/components/ui";
import { longDate, shortDate } from "@/engines/dates";
import { formatUSD } from "@/engines/money";
import { categoryTone } from "@/lib/category-colors";
import { newIdempotencyKey, useAction } from "@/lib/client/use-action";
import {
  confirmUsdAction,
  mapSplitwiseCategoryAction,
  markNotExpenseAction,
  resetCategoryAction,
  setCategoryAction,
  setLargeDismissedAction,
  undoDecisionAction,
} from "@/server/actions/expenses";
import type { DisplayRow } from "@/server/month-data";
import { ExpenseForm } from "./expense-form";

type Cat = { id: string; name: string };
const NEEDS = "__needs__";

export function statusLabel(r: DisplayRow): { tone: "neutral" | "forest" | "warn" | "danger"; text: string } {
  if (r.status === "review") return { tone: "warn", text: "Needs review" };
  if (r.status === "excluded") return { tone: "neutral", text: "Excluded" };
  if (r.flags.includes("needs_category")) return { tone: "warn", text: "Needs category" };
  return { tone: "forest", text: "Included" };
}

const money = (r: DisplayRow, minor: number) => (r.currency === "USD" ? formatUSD(minor) : `${(minor / 100).toFixed(2)} ${r.currency}`);

function Flags({ r }: { r: DisplayRow }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {r.flags.includes("large") && <Badge tone="warn">Large</Badge>}
      {r.flags.includes("auto_categorized") && <Badge>auto-categorized</Badge>}
      {r.source === "manual" && <Badge>manual</Badge>}
      {r.source === "recurring" && <Badge>recurring</Badge>}
    </span>
  );
}

function Chevron({ dir = "down", size = 14 }: { dir?: "down" | "right"; size?: number }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={dir === "down" ? "M5.5 8l4.5 4.5L14.5 8" : "M8 5.5l4.5 4.5L8 14.5"} />
    </svg>
  );
}

/** Colour-coded category. When editable it opens the shared dropdown, so changing it is one tap. */
function CategoryPill({ row, categories, order, editable }: { row: DisplayRow; categories: Cat[]; order: string[]; editable: boolean }) {
  const set = useAction(setCategoryAction, { success: "Category updated" });
  const tone = categoryTone(row.category, order);
  const label = row.category ?? "Choose category";
  const currentId = categories.find((c) => c.name === row.category)?.id ?? "";
  const shell = "relative inline-flex h-6 max-w-full items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition";
  const inner = (
    <>
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full" style={{ background: tone.dot }} />
      <span className="truncate">{label}</span>
    </>
  );
  if (!editable) {
    return (
      <span className={shell} style={{ background: tone.background, color: tone.color }}>
        {inner}
      </span>
    );
  }
  const options = categories.map((c) => ({ value: c.id, label: c.name, dot: categoryTone(c.name, order).dot }));
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Select
        ariaLabel={`Category for ${row.description}`}
        value={currentId}
        options={options}
        disabled={set.pending}
        onChange={(id) => set.run({ rowKey: row.key, categoryId: id })}
        triggerClassName={`${shell} outline-none hover:brightness-95 focus-visible:ring-2 focus-visible:ring-forest-600 ${set.pending ? "opacity-60" : ""} ${row.category ? "" : "border border-dashed border-warn/50"}`}
        triggerStyle={{ background: tone.background, color: tone.color }}
        renderValue={() => (
          <>
            {inner}
            <Chevron size={11} />
          </>
        )}
        hideChevron
        menuMinWidth={210}
      />
      {set.state.kind === "failed" && <SaveStatus state={set.state} />}
    </span>
  );
}

type ColKey = "date" | "category" | "share" | "cost" | "group" | "status";
const COLS: { key: ColKey; label: string }[] = [
  { key: "date", label: "Date" },
  { key: "category", label: "Category" },
  { key: "share", label: "My share" },
  { key: "cost", label: "Full cost" },
  { key: "group", label: "Group" },
  { key: "status", label: "Status" },
];
type SortKey = ColKey | "description";
const COLUMNS_KEY = "tally.transactions.columns.v2";
const ALL_ON: Record<ColKey, boolean> = { date: true, category: true, share: true, cost: true, group: true, status: true };

/** Dropdown with a checklist of which columns are shown. */
function ColumnsMenu({ cols, setCol }: { cols: Record<ColKey, boolean>; setCol: (k: ColKey, v: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const shown = COLS.filter((c) => cols[c.key]).length;
  return (
    <div className="hidden md:block">
      <button
        ref={ref}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-11 w-full items-center justify-between gap-2.5 rounded-xl border border-line bg-surface px-3 text-sm outline-none transition hover:bg-forest-50/50 focus-visible:border-forest-600"
      >
        <span className="flex items-center gap-2">
          <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="text-muted">
            <rect x="3.5" y="4.5" width="13" height="11" rx="1.5" />
            <path d="M8 4.5v11M12.5 4.5v11" />
          </svg>
          Columns
          <span className="rounded-full bg-forest-50 px-1.5 text-xs text-forest-800">
            {shown}/{COLS.length}
          </span>
        </span>
        <Chevron />
      </button>
      <Popover open={open} anchorRef={ref} onClose={close} align="end" minWidth={224} role="group" label="Show columns">
        {COLS.map((c) => (
          <label key={c.key} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm transition hover:bg-forest-50">
            <input type="checkbox" checked={cols[c.key]} onChange={(e) => setCol(c.key, e.target.checked)} className="size-4 accent-forest-700" />
            {c.label}
          </label>
        ))}
        <p className="px-3 pb-1 pt-1.5 text-xs text-faint">Description is always shown.</p>
      </Popover>
    </div>
  );
}

function SortIcon({ state }: { state: "asc" | "desc" | null }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 14" width="10" height="12" fill="currentColor" className={state ? "text-forest-700" : "text-faint/60"}>
      <path d="M6 1.5l3.5 4.5h-7z" opacity={state === "desc" ? 0.25 : 1} />
      <path d="M6 12.5L2.5 8h7z" opacity={state === "asc" ? 0.25 : 1} />
    </svg>
  );
}

const compareText = (a: string, b: string) => a.localeCompare(b, "en", { sensitivity: "base" });

function sortValue(r: DisplayRow, key: SortKey): string | number {
  switch (key) {
    case "date":
      return r.date;
    case "description":
      return r.description;
    case "category":
      return r.category ?? "￿"; // rows needing a category sort last ascending
    case "share":
      return r.status === "included" ? r.shareMinor : 0;
    case "cost":
      return r.costMinor;
    case "group":
      return r.group ?? "￿";
    case "status":
      return statusLabel(r).text;
  }
}

export function Transactions({ rows, categories, month, closed }: { rows: DisplayRow[]; categories: Cat[]; month: string; closed: boolean }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string[]>([]);
  const [group, setGroup] = useState<string[]>([]);
  const [status, setStatus] = useState<string[]>(["included"]);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "date", dir: "desc" });
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [cols, setCols] = useState<Record<ColKey, boolean>>(ALL_ON);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(COLUMNS_KEY) ?? "null") as Partial<Record<ColKey, boolean>> | null;
      if (saved) setCols({ ...ALL_ON, ...saved });
    } catch {
      /* storage unavailable: keep defaults */
    }
  }, []);
  const setCol = (k: ColKey, v: boolean) =>
    setCols((c) => {
      const next = { ...c, [k]: v };
      try {
        localStorage.setItem(COLUMNS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "share" || key === "cost" || key === "date" ? "desc" : "asc" }));

  const order = useMemo(() => categories.map((c) => c.name), [categories]);
  const groups = useMemo(() => [...new Set(rows.map((r) => r.group).filter(Boolean))].sort() as string[], [rows]);
  const filtered = useMemo(() => {
    const out = rows.filter((r) => {
      if (q && !`${r.description} ${r.group ?? ""} ${r.sourceCategory ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
      if (cat.length) {
        const needsCat = r.category === null && r.status === "included";
        const matches = (r.category !== null && cat.includes(r.category)) || (needsCat && cat.includes(NEEDS));
        if (!matches) return false;
      }
      if (group.length && !(r.group && group.includes(r.group))) return false;
      if (status.length && !status.includes(r.status)) return false;
      return true;
    });
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...out].sort((a, b) => {
      const x = sortValue(a, sort.key);
      const y = sortValue(b, sort.key);
      const c = typeof x === "number" && typeof y === "number" ? x - y : compareText(String(x), String(y));
      return c !== 0 ? c * dir : compareText(a.description, b.description);
    });
  }, [rows, q, cat, group, status, sort]);
  const shownTotal = filtered.filter((r) => r.status === "included").reduce((s, r) => s + r.shareMinor, 0);
  const open = rows.find((r) => r.key === openKey) ?? null;
  const field = "h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm outline-none transition focus:border-forest-600";
  const filtersActive = !!(q || cat.length || group.length || status.join() !== "included");

  const th = (k: SortKey, label: string, right = false) => {
    const active = sort.key === k ? sort.dir : null;
    return (
      <th key={k} scope="col" aria-sort={active === "asc" ? "ascending" : active === "desc" ? "descending" : "none"} className={`px-3 py-2.5 font-medium ${right ? "text-right" : ""}`}>
        <button type="button" onClick={() => toggleSort(k)} className={`inline-flex items-center gap-1.5 whitespace-nowrap uppercase tracking-wide transition hover:text-ink ${active ? "text-ink" : ""} ${right ? "flex-row-reverse" : ""}`}>
          {label}
          <SortIcon state={active} />
        </button>
      </th>
    );
  }

  return (
    <div className="space-y-4">
      {/* One row of filters, full width; Columns sits at the end */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto]">
        <div className="relative">
          <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="9" cy="9" r="5.5" />
            <path d="M13.5 13.5L17 17" />
          </svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search description, group or category" aria-label="Search transactions" className={`${field} pl-10`} />
        </div>
        <MultiSelect
          ariaLabel="Filter by category"
          values={cat}
          onChange={setCat}
          allLabel="All categories"
          noun="categories"
          menuMinWidth={240}
          options={[...categories.map((c) => ({ value: c.name, label: c.name, dot: categoryTone(c.name, order).dot })), { value: NEEDS, label: "Needs category", dot: categoryTone(null, order).dot }]}
        />
        <MultiSelect ariaLabel="Filter by group" values={group} onChange={setGroup} allLabel="All groups" noun="groups" menuMinWidth={260} options={groups.map((g) => ({ value: g, label: g }))} />
        <MultiSelect
          ariaLabel="Filter by status"
          values={status}
          onChange={setStatus}
          allLabel="All statuses"
          noun="statuses"
          options={[
            { value: "included", label: "Included" },
            { value: "excluded", label: "Excluded" },
            { value: "review", label: "Needs review" },
          ]}
        />
        <ColumnsMenu cols={cols} setCol={setCol} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          <span className="font-medium text-ink">{filtered.length}</span> of {rows.length} rows
          {filtersActive && (
            <button
              onClick={() => {
                setQ("");
                setCat([]);
                setGroup([]);
                setStatus(["included"]);
              }}
              className="ml-2 font-medium text-forest-700 hover:underline"
            >
              Reset filters
            </button>
          )}
        </p>
        <label className="flex items-center gap-2 text-sm text-muted md:hidden">
          Sort
          <Select
            ariaLabel="Sort by"
            value={`${sort.key}:${sort.dir}`}
            onChange={(v) => {
              const [key, dir] = v.split(":") as [SortKey, "asc" | "desc"];
              setSort({ key, dir });
            }}
            options={[
              { value: "date:desc", label: "Newest first" },
              { value: "date:asc", label: "Oldest first" },
              { value: "share:desc", label: "Biggest share" },
              { value: "share:asc", label: "Smallest share" },
              { value: "description:asc", label: "Description A–Z" },
              { value: "category:asc", label: "Category A–Z" },
            ]}
            className="w-44"
            align="end"
          />
        </label>
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-hidden rounded-2xl border border-line md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-forest-50/70 text-left text-xs text-muted">
              <tr className="border-b border-line">
                {cols.date && th("date", "Date")}
                {th("description", "Description")}
                {cols.category && th("category", "Category")}
                {cols.share && th("share", "My share", true)}
                {cols.cost && th("cost", "Full cost", true)}
                {cols.group && th("group", "Group")}
                {cols.status && th("status", "Status")}
                <th className="py-2.5 pl-3 pr-4">
                  <span className="sr-only">Details</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const s = statusLabel(r);
                const editable = !closed && r.source !== "recurring" && r.status !== "excluded";
                return (
                  <tr key={r.key} className={`border-b border-line/50 align-middle transition odd:bg-surface even:bg-canvas/70 hover:bg-forest-50/60 ${r.status === "excluded" ? "text-muted" : ""}`}>
                    {cols.date && <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-muted">{shortDate(r.date)}</td>}
                    <td className="px-3 py-2.5">
                      <div className="font-medium">{r.description}</div>
                      <Flags r={r} />
                    </td>
                    {cols.category && (
                      <td className="px-3 py-2.5">{r.status === "excluded" ? <span className="text-faint">—</span> : <CategoryPill row={r} categories={categories} order={order} editable={editable} />}</td>
                    )}
                    {cols.share && (
                      <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${r.status === "included" ? "" : "font-normal line-through decoration-faint"}`}>
                        <Usd minor={r.status === "included" ? r.shareMinor : 0} />
                      </td>
                    )}
                    {cols.cost && <td className="px-3 py-2.5 text-right tabular-nums text-faint">{money(r, r.costMinor)}</td>}
                    {cols.group && (
                      <td className="max-w-44 truncate px-3 py-2.5 text-muted" title={r.group ?? ""}>
                        {r.group ?? "—"}
                      </td>
                    )}
                    {cols.status && (
                      <td className="px-3 py-2.5">
                        <Badge tone={s.tone}>{s.text}</Badge>
                        {r.status !== "included" && <div className="mt-1 max-w-48 text-xs text-muted">{r.reasonText}</div>}
                      </td>
                    )}
                    <td className="py-2.5 pl-3 pr-4 text-right">
                      <button onClick={() => setOpenKey(r.key)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-sm font-medium transition hover:bg-forest-50">
                        {closed ? "View" : "Edit"}
                        <Chevron dir="right" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {filtered.length > 0 && cols.share && (
              <tfoot className="border-t-2 border-line bg-forest-50/50 text-sm font-semibold">
                <tr>
                  {cols.date && <td className="px-3 py-3" />}
                  <td className="px-3 py-3">Total of included rows shown</td>
                  {cols.category && <td className="px-3 py-3" />}
                  <td className="px-3 py-3 text-right tabular-nums">
                    <Usd minor={shownTotal} />
                  </td>
                  {cols.cost && <td className="px-3 py-3" />}
                  {cols.group && <td className="px-3 py-3" />}
                  {cols.status && <td className="px-3 py-3" />}
                  <td className="px-3 py-3" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Mobile cards */}
      <ul className="space-y-2 md:hidden">
        {filtered.map((r) => {
          const s = statusLabel(r);
          return (
            <li key={r.key}>
              <button onClick={() => setOpenKey(r.key)} className="w-full rounded-xl border border-line bg-surface p-3 text-left active:bg-forest-50">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className={`truncate font-medium ${r.status === "excluded" ? "text-muted" : ""}`}>{r.description}</p>
                    <p className="text-xs text-muted">
                      {shortDate(r.date)} · {r.group ?? "—"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`font-semibold ${r.status === "included" ? "" : "text-muted line-through"}`}>
                      <Usd minor={r.status === "included" ? r.shareMinor : 0} />
                    </p>
                    <p className="text-xs text-faint">of {money(r, r.costMinor)}</p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {r.status !== "excluded" && <CategoryPill row={r} categories={categories} order={order} editable={false} />}
                  <Badge tone={s.tone}>{s.text}</Badge>
                  <Flags r={r} />
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      {filtered.length === 0 && <p className="rounded-2xl border border-dashed border-line py-8 text-center text-sm text-muted">No rows match these filters.</p>}

      <RowDrawer row={open} categories={categories} month={month} closed={closed} onClose={() => setOpenKey(null)} />
    </div>
  );
}

/** The side drawer for one row. */
export function RowDrawer({ row, categories, month, closed, onClose }: { row: DisplayRow | null; categories: Cat[]; month: string; closed: boolean; onClose: () => void }) {
  return (
    <Drawer open={!!row} onClose={onClose} title={row?.description ?? ""} subtitle={row ? `${longDate(row.date)}${row.group ? ` · ${row.group}` : ""}` : undefined}>
      {row && <RowDetail key={row.key} row={row} categories={categories} month={month} closed={closed} onClose={onClose} />}
    </Drawer>
  );
}

function Panel({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

const subtle = "inline-flex h-10 items-center rounded-xl border border-line bg-surface px-3.5 text-sm font-medium transition hover:bg-forest-50 disabled:opacity-60";

export function RowDetail({ row, categories, month, closed, onClose }: { row: DisplayRow; categories: Cat[]; month: string; closed: boolean; onClose: () => void }) {
  const setCat = useAction(setCategoryAction, { success: "Category updated" });
  const resetCat = useAction(resetCategoryAction, { success: "Back to the automatic category" });
  const mapCat = useAction(mapSplitwiseCategoryAction, { success: "Mapping saved for future syncs" });
  const markNot = useAction(markNotExpenseAction, { success: "Marked as not an expense" });
  const undo = useAction(undoDecisionAction, { success: "Back in your spending" });
  const largeFlag = useAction(setLargeDismissedAction, { success: "Large flag updated" });
  const usd = useAction(confirmUsdAction, { success: "USD amount confirmed" });
  const [idem] = useState(newIdempotencyKey);
  const [reason, setReason] = useState("");
  const [usdAmount, setUsdAmount] = useState("");
  const [editingManual, setEditingManual] = useState(false);
  const [showWork, setShowWork] = useState(false);
  const order = categories.map((c) => c.name);
  const tone = categoryTone(row.category, order);
  const currentCatId = categories.find((c) => c.name === row.category)?.id ?? "";
  const s = statusLabel(row);
  const canDecide = !closed && row.source !== "recurring" && row.source !== "manual";
  const counts = row.status === "included";

  if (editingManual && row.manual) {
    return (
      <ExpenseForm
        month={month}
        categories={categories}
        editing={{ id: row.manual.id, version: row.manual.version, date: row.date, description: row.description, categoryId: row.manual.categoryId, amountMinor: row.manual.amountMinor, note: row.manual.note }}
        onDone={onClose}
      />
    );
  }

  const failed = [setCat.state, resetCat.state, mapCat.state].filter((st) => st.kind === "failed" || st.kind === "saving");

  return (
    <div className="space-y-4 text-sm">
      {/* Hero: what this expense costs me */}
      <section className="rounded-2xl bg-forest-800 p-6 text-canvas">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-forest-100/80">My share</p>
            <p className={`mt-1 text-4xl font-semibold tracking-tight tabular-nums ${counts ? "" : "line-through decoration-forest-100/50"}`}>{formatUSD(counts ? row.shareMinor : 0)}</p>
            <p className="mt-1.5 text-forest-100/80">
              of <span className="font-medium text-canvas tabular-nums">{money(row, row.costMinor)}</span> full cost
            </p>
          </div>
          <span className={`inline-flex h-8 items-center rounded-full px-3 text-xs font-semibold ${s.tone === "forest" ? "bg-forest-100 text-forest-800" : s.tone === "warn" ? "bg-warn-50 text-warn" : "bg-canvas text-muted"}`}>{s.text}</span>
        </div>
        {row.status !== "included" && <p className="mt-4 rounded-lg bg-white/10 px-3 py-2 text-forest-100">{row.reasonText}</p>}
      </section>

      <section className="rounded-2xl border border-line bg-surface">
        <button type="button" aria-expanded={showWork} onClick={() => setShowWork((v) => !v)} className="flex w-full items-center justify-between gap-3 rounded-2xl px-5 py-4 text-left transition hover:bg-forest-50/50">
          <span>
            <span className="text-sm font-semibold">How my share was worked out</span>
            <span className="ml-2 text-xs text-faint">{row.derivation.length} steps</span>
          </span>
          <span className={`text-muted transition-transform duration-200 ${showWork ? "rotate-180" : ""}`}>
            <Chevron size={16} />
          </span>
        </button>
        {showWork && (
          <ol className="animate-fade-in space-y-3 border-t border-line px-5 py-4">
            {row.derivation.map((d, i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-forest-50 text-xs font-semibold text-forest-800">{i + 1}</span>
                <span className="min-w-0 break-words text-muted">{d}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <Panel
        title="Category"
        aside={
          <span className="inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium" style={{ background: tone.background, color: tone.color }}>
            <span aria-hidden="true" className="size-2 rounded-full" style={{ background: tone.dot }} />
            {row.hasOverride ? "Set manually" : row.categorySource === "mapping" ? "From Splitwise mapping" : row.categorySource === "none" ? "Needs a category" : "Automatic"}
          </span>
        }
      >
        {row.categorySource !== "mapping" && row.categorySource !== "none" && <p className="text-muted">{row.categoryExplanation}</p>}
        {row.categorySource === "none" && <p className="text-muted">{row.suggestion ? `Suggested: ${row.suggestion}.` : "Pick a category for this expense."}</p>}
        {!closed && row.source !== "recurring" && (
          <div className="mt-4 space-y-3">
            <Select
              ariaLabel="Category"
              size="lg"
              value={currentCatId}
              placeholder="Choose a category…"
              disabled={setCat.pending || resetCat.pending}
              options={categories.map((c) => ({ value: c.id, label: c.name, dot: categoryTone(c.name, order).dot }))}
              onChange={(id) => setCat.run({ rowKey: row.key, categoryId: id })}
            />
            {(row.hasOverride || (row.sourceCategory && (row.suggestion || (currentCatId && row.categorySource !== "mapping")))) && (
              <div className="flex flex-wrap gap-2">
                {row.hasOverride && (
                  <button disabled={resetCat.pending} onClick={() => resetCat.run({ rowKey: row.key })} className={subtle}>
                    Reset to automatic
                  </button>
                )}
                {row.sourceCategory && row.suggestion && (
                  <button
                    disabled={mapCat.pending}
                    onClick={() => {
                      const id = categories.find((c) => c.name === row.suggestion)?.id;
                      if (id) mapCat.run({ splitwiseName: row.sourceCategory!, categoryId: id });
                    }}
                    className="inline-flex h-10 items-center rounded-xl border border-forest-100 bg-forest-50 px-3.5 text-sm font-medium text-forest-800 transition hover:bg-forest-100 disabled:opacity-60"
                  >
                    Always map “{row.sourceCategory}” → {row.suggestion}
                  </button>
                )}
                {row.sourceCategory && !row.suggestion && currentCatId && row.categorySource !== "mapping" && (
                  <button disabled={mapCat.pending} onClick={() => mapCat.run({ splitwiseName: row.sourceCategory!, categoryId: currentCatId })} className={subtle}>
                    Always map “{row.sourceCategory}” → {row.category}
                  </button>
                )}
              </div>
            )}
            {failed.map((st, i) => (
              <SaveStatus key={i} state={st} />
            ))}
          </div>
        )}
      </Panel>

      {!closed && (row.flags.includes("large") || row.largeDismissed) && (
        <Panel title="Large expense" aside={<Badge tone={row.largeDismissed ? "neutral" : "warn"}>{row.largeDismissed ? "Dismissed" : "Flagged"}</Badge>}>
          <p className="text-muted">{row.largeDismissed ? "You marked this one as expected, so it no longer shows under Needs attention." : "Your share is over the large-expense threshold. If that's expected, dismiss the flag."}</p>
          <div className="mt-3">
            <button disabled={largeFlag.pending} onClick={() => largeFlag.run({ rowKey: row.key, dismissed: !row.largeDismissed })} className={subtle}>
              {row.largeDismissed ? "Show the flag again" : "Dismiss — this is expected"}
            </button>
          </div>
          {largeFlag.state.kind === "failed" && <div className="mt-2"><SaveStatus state={largeFlag.state} /></div>}
        </Panel>
      )}

      {!closed && row.reason === "non_usd" && row.splitwiseId && (
        <Panel title="Confirm the USD amount">
          <p className="text-muted">Not counted until you enter what my share cost in USD.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input inputMode="decimal" value={usdAmount} onChange={(e) => setUsdAmount(e.target.value)} placeholder="USD" aria-label="USD amount" className="h-11 w-36 rounded-xl border border-line bg-surface px-3 outline-none focus:border-forest-600" />
            <button disabled={usd.pending} onClick={() => usd.run({ splitwiseId: row.splitwiseId!, usdAmount, note: null })} className="h-11 rounded-xl bg-forest-700 px-5 font-medium text-white transition hover:bg-forest-800 disabled:opacity-60">
              Confirm
            </button>
          </div>
          {usd.state.kind === "failed" && <div className="mt-2"><SaveStatus state={usd.state} /></div>}
        </Panel>
      )}

      {canDecide && (
        <Panel title="Not an expense?">
          {row.decision ? (
            <div className="space-y-3">
              <p className="text-muted">Marked “{row.decision.reason || "Not an expense"}”. It's out of your spending.</p>
              <button disabled={undo.pending} onClick={() => undo.run({ id: row.decision!.id, expectedVersion: row.decision!.version })} className={subtle}>
                Undo
              </button>
              {undo.state.kind === "failed" && <SaveStatus state={undo.state} />}
            </div>
          ) : row.status !== "excluded" ? (
            <div className="space-y-3">
              <p className="text-muted">For money moving between people, like a balance transfer. Only this expense — no rule is created for similar ones.</p>
              <div className="flex flex-wrap gap-2">
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" aria-label="Reason" maxLength={300} className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 outline-none focus:border-forest-600" />
                <button disabled={markNot.pending} onClick={() => markNot.run({ rowKey: row.key, reason: reason.trim() || null, idempotencyKey: idem })} className="inline-flex h-11 items-center rounded-xl border border-line bg-surface px-4 font-medium transition hover:bg-forest-50 disabled:opacity-60">
                  Not an expense
                </button>
              </div>
              {markNot.state.kind === "failed" && <SaveStatus state={markNot.state} />}
            </div>
          ) : (
            <p className="text-muted">Already excluded by a rule ({row.reasonText}).</p>
          )}
        </Panel>
      )}

      {!closed && row.manual && (
        <button onClick={() => setEditingManual(true)} className={`${subtle} h-11 w-full justify-center`}>
          Edit or delete this expense
        </button>
      )}
      {!closed && (row.source === "splitwise" || row.source === "csv") && (
        <p className="px-1 text-xs leading-relaxed text-faint">
          The amount, date and description come from Splitwise. Change them there and sync again. Here you can change the category, mark it as not an expense, and dismiss the large-expense flag.
        </p>
      )}
      {closed && <p className="rounded-xl bg-canvas px-1 text-xs text-faint">This month is closed — rows are shown as they were frozen. Reopen the month to make changes.</p>}
    </div>
  );
}
