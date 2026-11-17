"use client";

import { useMemo, useState } from "react";
import { CategoryIcon } from "@/components/category-icon";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Drawer } from "@/components/drawer";
import { SaveStatus } from "@/components/save-status";
import { Select } from "@/components/select";
import { Badge, Card, EmptyState } from "@/components/ui";
import { addMonths, monthLabel } from "@/engines/dates";
import type { SeriesStatus } from "@/engines/recurring";
import { formatUSD } from "@/engines/money";
import { useAction } from "@/lib/client/use-action";
import { changeRecurringFromAction, createRecurringAction, deleteRecurringAction, setRecurringEndAction, setRecurringOverrideAction } from "@/server/actions/recurring";

interface Series {
  series: string;
  name: string;
  category: string;
  dayOfMonth: number;
  amountMinor: number;
  baseAmountMinor: number;
  status: SeriesStatus;
  startsOn: string;
  endsOn: string | null;
  override: { amountMinor: number | null; note: string | null } | null;
  paymentNumber: number | null;
  paymentsTotal: number | null;
  paymentsLeft: number | null;
  versions: { effectiveFrom: string; amountMinor: number }[];
}

const field = "h-11 w-full rounded-xl border border-line bg-surface px-3 outline-none transition focus:border-forest-600";
const dollars = (minor: number) => (minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2));

const STATUS: Record<SeriesStatus, { label: (s: Series) => string; tone: "forest" | "warn" | "neutral" }> = {
  active: { label: () => "Counted this month", tone: "forest" },
  skipped: { label: () => "Skipped this month", tone: "warn" },
  upcoming: { label: (s) => `Starts ${monthLabel(s.startsOn, "short")}`, tone: "neutral" },
  ended: { label: (s) => `Ended ${s.endsOn ? monthLabel(s.endsOn, "short") : ""}`, tone: "neutral" },
};

/** Months to pick from: a little before the one you're viewing to a few years ahead. */
function monthOptions(center: string, extra: string[] = []) {
  const set = new Set<string>([...Array.from({ length: 60 }, (_, i) => addMonths(center, i - 12)), ...extra]);
  return [...set].sort().map((m) => ({ value: m, label: monthLabel(m, "short") }));
}

function Amount({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <label className="space-y-1 text-sm">
      <span className="text-muted">{label}</span>
      <span className="flex items-center rounded-xl border border-line bg-surface px-3 transition focus-within:border-forest-600">
        <span className="text-muted">$</span>
        <input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} className="h-11 w-full bg-transparent px-1 outline-none" />
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------------------------- add

function AddForm({ month, categories, onDone }: { month: string; categories: { id: string; name: string }[]; onDone: () => void }) {
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState("1");
  const [from, setFrom] = useState(month);
  const [ends, setEnds] = useState<"never" | "count" | "month">("never");
  const [count, setCount] = useState("12");
  const [last, setLast] = useState(addMonths(month, 11));
  const create = useAction(createRecurringAction, { success: "Recurring item added" });
  const months = useMemo(() => monthOptions(month, [from, last]), [month, from, last]);
  const effectiveTo = ends === "never" ? null : ends === "count" ? addMonths(from, Math.max(1, Number(count) || 1) - 1) : last;
  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await create.run({ name, categoryId, amount, dayOfMonth: Number(day) || 1, effectiveFrom: from, effectiveTo });
        if (r?.ok) onDone();
      }}
    >
      <label className="block space-y-1 text-sm">
        <span className="text-muted">What is it?</span>
        <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. iPhone instalment (Apple Card)" className={field} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1 text-sm">
          <span className="text-muted">Category</span>
          <Select ariaLabel="Category" value={categoryId} onChange={setCategoryId} options={categories.map((c) => ({ value: c.id, label: c.name }))} placeholder="Choose category" />
        </div>
        <Amount label="Amount each month" value={amount} onChange={setAmount} />
        <div className="space-y-1 text-sm">
          <span className="text-muted">First month</span>
          <Select ariaLabel="First month" value={from} onChange={setFrom} options={months} />
        </div>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Day of the month</span>
          <input inputMode="numeric" value={day} onChange={(e) => setDay(e.target.value)} className={field} />
        </label>
      </div>
      <fieldset className="space-y-2 text-sm">
        <legend className="mb-1 font-medium">How long does it last?</legend>
        {(
          [
            ["never", "No end", "Rent, subscriptions, anything ongoing."],
            ["count", "A number of payments", "An instalment plan: it stops after the last one."],
            ["month", "Until a month", "Counted up to and including that month."],
          ] as const
        ).map(([value, title, hint]) => (
          <label key={value} className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${ends === value ? "border-forest-600 bg-forest-50" : "border-line"}`}>
            <input type="radio" name="ends" checked={ends === value} onChange={() => setEnds(value)} className="mt-1 accent-forest-700" />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{title}</span>
              <span className="block text-xs text-muted">{hint}</span>
              {value === "count" && ends === "count" && (
                <span className="mt-2 flex items-center gap-2">
                  <input inputMode="numeric" aria-label="Number of payments" value={count} onChange={(e) => setCount(e.target.value)} className="h-10 w-24 rounded-lg border border-line bg-surface px-3" />
                  <span className="text-muted">payments, last one in {monthLabel(effectiveTo ?? from, "short")}</span>
                </span>
              )}
              {value === "month" && ends === "month" && (
                <span className="mt-2 block max-w-48">
                  <Select ariaLabel="Last month" value={last} onChange={setLast} options={months} />
                </span>
              )}
            </span>
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={create.pending || !categoryId || !name.trim()} className="h-11 rounded-xl bg-forest-700 px-5 text-sm font-medium text-white transition hover:bg-forest-800 disabled:opacity-50">
          Add
        </button>
        <SaveStatus state={create.state.kind === "saved" ? { kind: "idle" } : create.state} />
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------------------------- edit

function EditForm({ s, month, closed, categories, onDone }: { s: Series; month: string; closed: boolean; categories: { id: string; name: string }[]; onDone: () => void }) {
  const catId = categories.find((c) => c.name === s.category)?.id ?? "";
  const [name, setName] = useState(s.name);
  const [categoryId, setCategoryId] = useState(catId);
  const [amount, setAmount] = useState(dollars(s.baseAmountMinor));
  const [day, setDay] = useState(String(s.dayOfMonth));
  const [from, setFrom] = useState(month > s.startsOn ? month : s.startsOn);
  const [thisAmount, setThisAmount] = useState(dollars(s.override?.amountMinor ?? s.baseAmountMinor));
  const [last, setLast] = useState(s.endsOn ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const change = useAction(changeRecurringFromAction, { success: "Saved" });
  const override = useAction(setRecurringOverrideAction, { success: "Done" });
  const end = useAction(setRecurringEndAction, { success: "End date saved" });
  const del = useAction(deleteRecurringAction, { success: "Removed" });
  const months = useMemo(() => monthOptions(month, [from, s.startsOn, ...(s.endsOn ? [s.endsOn] : [])]), [month, from, s.startsOn, s.endsOn]);
  const endMonths = useMemo(() => [{ value: "", label: "No end" }, ...monthOptions(month, [last].filter(Boolean))], [month, last]);
  const active = s.status === "active" || s.status === "skipped";
  return (
    <div className="space-y-8">
      {closed && <p className="rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-muted">{monthLabel(month)} is closed, so it keeps the numbers it was closed with. Changes apply to open months.</p>}

      <section className="space-y-4">
        <h3 className="text-sm font-semibold">Change it from a month onward</h3>
        <p className="text-xs text-muted">Earlier months keep what they had.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1 text-sm sm:col-span-2">
            <span className="text-muted">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={field} />
          </label>
          <div className="space-y-1 text-sm">
            <span className="text-muted">Category</span>
            <Select ariaLabel="Category" value={categoryId} onChange={setCategoryId} options={categories.map((c) => ({ value: c.id, label: c.name }))} />
          </div>
          <Amount label="Amount each month" value={amount} onChange={setAmount} />
          <div className="space-y-1 text-sm">
            <span className="text-muted">Starting in</span>
            <Select ariaLabel="Change starting in" value={from} onChange={setFrom} options={months} />
          </div>
          <label className="space-y-1 text-sm">
            <span className="text-muted">Day of the month</span>
            <input inputMode="numeric" value={day} onChange={(e) => setDay(e.target.value)} className={field} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            disabled={change.pending || !name.trim()}
            onClick={async () => {
              const r = await change.run({ series: s.series, from, amount, name, categoryId: categoryId || undefined, dayOfMonth: Number(day) || undefined });
              if (r?.ok) onDone();
            }}
            className="h-11 rounded-xl bg-forest-700 px-5 text-sm font-medium text-white transition hover:bg-forest-800 disabled:opacity-50"
          >
            Save from {monthLabel(from, "short")}
          </button>
          <SaveStatus state={change.state.kind === "saved" ? { kind: "idle" } : change.state} />
        </div>
      </section>

      {active && (
        <section className="space-y-3 border-t border-line pt-6">
          <h3 className="text-sm font-semibold">Just {monthLabel(month)}</h3>
          <div className="flex flex-wrap items-end gap-2">
            <button disabled={override.pending} onClick={() => void override.run({ series: s.series, month, amount: null, note: null })} className="h-11 rounded-xl border border-line bg-surface px-4 text-sm font-medium transition hover:bg-forest-50 disabled:opacity-60">
              Skip this month
            </button>
            <div className="flex items-end gap-2">
              <div className="w-32">
                <Amount label="Or charge" value={thisAmount} onChange={setThisAmount} />
              </div>
              <button disabled={override.pending} onClick={() => void override.run({ series: s.series, month, amount: thisAmount, note: null })} className="h-11 rounded-xl border border-line bg-surface px-4 text-sm font-medium transition hover:bg-forest-50 disabled:opacity-60">
                Use this
              </button>
            </div>
            {s.override && (
              <button disabled={override.pending} onClick={() => void override.run({ series: s.series, month, amount: null, note: null, clear: true })} className="h-11 rounded-xl px-3 text-sm text-brand transition hover:underline disabled:opacity-60">
                Back to normal
              </button>
            )}
          </div>
          <SaveStatus state={override.state.kind === "saved" ? { kind: "idle" } : override.state} />
        </section>
      )}

      <section className="space-y-3 border-t border-line pt-6">
        <h3 className="text-sm font-semibold">When does it end?</h3>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-44">
            <Select ariaLabel="Last month" value={last} onChange={setLast} options={endMonths} />
          </div>
          <button disabled={end.pending} onClick={() => void end.run({ series: s.series, lastMonth: last || null })} className="h-11 rounded-xl border border-line bg-surface px-4 text-sm font-medium transition hover:bg-forest-50 disabled:opacity-60">
            Save
          </button>
        </div>
        <p className="text-xs text-muted">The last month it still counts. Pick “No end” for ongoing items.</p>
        <SaveStatus state={end.state.kind === "saved" ? { kind: "idle" } : end.state} />
      </section>

      <section className="border-t border-line pt-6">
        <button onClick={() => setConfirmDelete(true)} className="h-11 rounded-xl border border-danger/30 px-4 text-sm font-medium text-danger transition hover:bg-danger-50">
          Delete this item
        </button>
      </section>

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete “${s.name}”?`}
        confirmLabel="Delete"
        busy={del.pending}
        error={del.state.kind === "failed" ? <SaveStatus state={del.state} /> : null}
        onCancel={() => {
          setConfirmDelete(false);
          del.reset();
        }}
        onConfirm={async () => {
          const r = await del.run({ series: s.series });
          if (r?.ok) {
            setConfirmDelete(false);
            onDone();
          }
        }}
      >
        It stops being counted in open months, past and future. Closed months keep the numbers they were closed with.
      </ConfirmDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- list

function Row({ s, onEdit }: { s: Series; onEdit: () => void }) {
  const st = STATUS[s.status];
  const dim = s.status === "ended" || s.status === "upcoming";
  return (
    <li className={`py-4 ${dim ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl bg-forest-50 text-brand">
            <CategoryIcon name={s.category} size={20} />
          </span>
          <div className="min-w-0">
            <p className="break-words font-medium">{s.name}</p>
            <p className="text-sm text-muted">
              {s.category} · day {s.dayOfMonth}
              {s.override?.amountMinor != null && ` · this month ${formatUSD(s.override.amountMinor)}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className={`text-lg font-semibold tabular-nums ${s.status === "skipped" ? "text-faint line-through" : ""}`}>{formatUSD(s.amountMinor, { decimals: "auto" })}</p>
            <p className="text-xs text-muted">per month</p>
          </div>
          <button onClick={onEdit} className="h-10 rounded-xl border border-line bg-surface px-4 text-sm font-medium transition hover:bg-forest-50">
            Edit
          </button>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Badge tone={st.tone}>{st.label(s)}</Badge>
        {s.paymentsTotal !== null && s.paymentNumber !== null && (
          <span className="text-xs text-muted">
            Payment {s.paymentNumber} of {s.paymentsTotal} · {s.paymentsLeft === 0 ? "last one" : `${s.paymentsLeft} left`}
            {s.endsOn && ` · ends ${monthLabel(s.endsOn, "short")}`}
          </span>
        )}
        {s.paymentsTotal === null && s.status !== "ended" && <span className="text-xs text-muted">No end date</span>}
      </div>
      {s.paymentsTotal !== null && s.paymentNumber !== null && (
        <div aria-hidden="true" className="mt-2 h-1.5 overflow-hidden rounded-full bg-canvas">
          <div className="h-full rounded-full bg-forest-600 transition-[width] duration-500" style={{ width: `${Math.round((s.paymentNumber / s.paymentsTotal) * 100)}%` }} />
        </div>
      )}
    </li>
  );
}

export function RecurringPanel({ month, closed, series, categories }: { month: string; closed: boolean; series: Series[]; categories: { id: string; name: string }[] }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const current = series.find((s) => s.series === editing) ?? null;
  return (
    <>
      <Card
        title="Recurring items"
        action={
          <button onClick={() => setAdding(true)} className="inline-flex h-10 items-center gap-2 rounded-xl bg-forest-700 px-4 text-sm font-medium text-white transition hover:bg-forest-800">
            <svg aria-hidden="true" viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M10 4.5v11M4.5 10h11" />
            </svg>
            Add
          </button>
        }
      >
        <p className="mb-2 text-sm text-muted">Things you pay every month that aren&apos;t in Splitwise: rent, a phone instalment on your card, a subscription. They count in your spending and budget like any other expense.</p>
        {series.length === 0 ? (
          <EmptyState title="Nothing recurring yet">Add rent, an instalment plan or a subscription and it will show up in every month automatically.</EmptyState>
        ) : (
          <ul className="divide-y divide-line/70">
            {series.map((s) => (
              <Row key={s.series} s={s} onEdit={() => setEditing(s.series)} />
            ))}
          </ul>
        )}
      </Card>
      <Drawer open={adding} onClose={() => setAdding(false)} title="Add a recurring item" subtitle="It appears in every month from the first one you pick.">
        {adding && <AddForm month={month} categories={categories} onDone={() => setAdding(false)} />}
      </Drawer>
      <Drawer open={current !== null} onClose={() => setEditing(null)} title={current?.name ?? ""} subtitle={current ? `${current.category} · ${formatUSD(current.baseAmountMinor, { decimals: "auto" })} a month` : undefined}>
        {current && <EditForm key={current.series} s={current} month={month} closed={closed} categories={categories} onDone={() => setEditing(null)} />}
      </Drawer>
    </>
  );
}
