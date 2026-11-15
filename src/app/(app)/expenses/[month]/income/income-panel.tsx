"use client";

import { useState } from "react";
import { Drawer } from "@/components/drawer";
import { SaveStatus } from "@/components/save-status";
import { Badge } from "@/components/ui";
import { longDate, monthBounds, shortDate, todayNY } from "@/engines/dates";
import { formatUSD } from "@/engines/money";
import { DEFAULT_EMPLOYER, INCOME_SOURCE_LABEL, INCOME_SOURCE_OPTIONS, type IncomeSourceType } from "@/lib/income-sources";
import { newIdempotencyKey, useAction } from "@/lib/client/use-action";
import { addIncomeAction, deleteIncomeAction, updateIncomeAction } from "@/server/actions/income";

interface Entry {
  id: string;
  date: string;
  amountMinor: number;
  sourceType: IncomeSourceType;
  employer: string | null;
  note: string | null;
  version: number;
}

const field = "h-11 w-full rounded-xl border border-line bg-surface px-3 outline-none transition focus:border-forest-600";
const NAME_HINT: Record<IncomeSourceType, string> = {
  employer: "Employer",
  cash: "Who gave it (optional)",
  gift_family: "From whom (optional)",
  gift_card: "Which card (optional)",
  other: "What is it? (optional)",
};

export function sourceTitle(e: { sourceType: IncomeSourceType; employer: string | null }) {
  return e.sourceType === "employer" ? e.employer || "Employer" : e.employer ? `${INCOME_SOURCE_LABEL[e.sourceType]} · ${e.employer}` : INCOME_SOURCE_LABEL[e.sourceType];
}

function IncomeForm({ month, entry, onDone }: { month: string; entry: Entry | null; onDone: () => void }) {
  const { start, end } = monthBounds(month);
  const today = todayNY();
  const [idem] = useState(newIdempotencyKey);
  const [date, setDate] = useState(entry?.date ?? (today >= start && today <= end ? today : start));
  const [amount, setAmount] = useState(entry ? (entry.amountMinor / 100).toFixed(2) : "");
  const [sourceType, setSourceType] = useState<IncomeSourceType>(entry?.sourceType ?? "employer");
  const [name, setName] = useState(entry ? (entry.employer ?? "") : DEFAULT_EMPLOYER);
  const [note, setNote] = useState(entry?.note ?? "");
  const add = useAction(addIncomeAction, { success: "Income added" });
  const update = useAction(updateIncomeAction, { success: "Income updated" });
  const a = entry ? update : add;
  const del = useAction(deleteIncomeAction, { success: "Income deleted" });

  function pickType(t: IncomeSourceType) {
    setSourceType(t);
    // Employer income defaults to UNYT; other sources start with no name.
    if (t === "employer") setName((n) => n || DEFAULT_EMPLOYER);
    else setName((n) => (n === DEFAULT_EMPLOYER ? "" : n));
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const body = { date, amount, sourceType, employer: name.trim() || null, note: note.trim() || null };
        const res = entry ? await update.run({ ...body, id: entry.id, expectedVersion: entry.version }) : await add.run({ ...body, idempotencyKey: idem });
        if (res?.ok) onDone();
      }}
      className="space-y-5"
    >
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Income source</legend>
        <div className="flex flex-wrap gap-2">
          {INCOME_SOURCE_OPTIONS.map(([value, label]) => (
            <label key={value} className={`inline-flex h-10 cursor-pointer items-center rounded-full border px-4 text-sm font-medium transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-forest-600 ${sourceType === value ? "border-forest-700 bg-forest-700 text-white" : "border-line bg-surface hover:bg-forest-50"}`}>
              <input type="radio" name="income-source" value={value} checked={sourceType === value} onChange={() => pickType(value)} className="sr-only" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-muted">{sourceType === "employer" ? "Employer" : "Details"}</span>
          <input maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder={NAME_HINT[sourceType]} className={field} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Amount (USD)</span>
          <input required inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} className={field} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Date received</span>
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={field} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Note (optional)</span>
          <input maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className={field} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={a.pending} className="h-11 rounded-xl bg-forest-700 px-5 text-sm font-medium text-white transition hover:bg-forest-800 disabled:opacity-60">
          {entry ? "Save income" : "Add income"}
        </button>
        <SaveStatus state={a.state} />
      </div>
      {entry && (
        <div className="border-t border-line pt-4">
          <button
            type="button"
            disabled={del.pending}
            onClick={async () => {
              const r = await del.run({ id: entry.id, expectedVersion: entry.version });
              if (r?.ok) onDone();
            }}
            className="h-11 rounded-xl border border-danger/30 px-4 text-sm font-medium text-danger transition hover:bg-danger-50 disabled:opacity-60"
          >
            Delete this {formatUSD(entry.amountMinor)} income
          </button>
          <div className="mt-2"><SaveStatus state={del.state} /></div>
        </div>
      )}
    </form>
  );
}

export function AddIncomeButton({ month, label = "Add income" }: { month: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="inline-flex h-11 items-center gap-2 rounded-xl bg-forest-700 px-4 text-sm font-medium text-white transition hover:bg-forest-800">
        <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M10 4.5v11M4.5 10h11" />
        </svg>
        {label}
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title="Add income" subtitle="Paychecks, cash, gifts — anything that came in.">
        {open && <IncomeForm month={month} entry={null} onDone={() => setOpen(false)} />}
      </Drawer>
    </>
  );
}

function Row({ e, month }: { e: Entry; month: string }) {
  const [editing, setEditing] = useState(false);
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3.5">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          {sourceTitle(e)}
          {e.sourceType !== "employer" && <Badge>{INCOME_SOURCE_LABEL[e.sourceType]}</Badge>}
        </p>
        <p className="text-sm text-muted">
          {shortDate(e.date)}
          {e.note ? ` · ${e.note}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <span className="font-semibold tabular-nums">{formatUSD(e.amountMinor)}</span>
        <button onClick={() => setEditing(true)} className="inline-flex h-9 items-center rounded-lg border border-line bg-surface px-3 text-sm font-medium transition hover:bg-forest-50">
          Edit
        </button>
      </div>
      <Drawer open={editing} onClose={() => setEditing(false)} title="Edit income" subtitle={longDate(e.date)}>
        {editing && <IncomeForm month={month} entry={e} onDone={() => setEditing(false)} />}
      </Drawer>
    </li>
  );
}

export function IncomePanel({ month, entries }: { month: string; entries: Entry[] }) {
  return (
    <div className="space-y-4">
      {entries.length > 0 && (
        <ul className="divide-y divide-line/70">
          {entries.map((e) => (
            <Row key={e.id} e={e} month={month} />
          ))}
        </ul>
      )}
      {entries.length === 0 && <AddIncomeButton month={month} />}
    </div>
  );
}
