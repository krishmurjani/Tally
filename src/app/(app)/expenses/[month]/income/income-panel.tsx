"use client";

import { useState } from "react";
import { SaveStatus } from "@/components/save-status";
import { monthBounds, todayNY } from "@/engines/dates";
import { formatUSD } from "@/engines/money";
import { newIdempotencyKey, useAction } from "@/lib/client/use-action";
import { addIncomeAction, deleteIncomeAction, updateIncomeAction } from "@/server/actions/income";

interface Entry {
  id: string;
  date: string;
  amountMinor: number;
  employer: string | null;
  note: string | null;
  version: number;
}

const field = "h-11 w-full rounded-xl border border-line bg-surface px-3 outline-none focus:border-forest-600";

function IncomeForm({ month, entry, lastEmployer, onDone }: { month: string; entry: Entry | null; lastEmployer: string; onDone: () => void }) {
  const { start, end } = monthBounds(month);
  const today = todayNY();
  const [idem] = useState(newIdempotencyKey);
  const [date, setDate] = useState(entry?.date ?? (today >= start && today <= end ? today : start));
  const [amount, setAmount] = useState(entry ? (entry.amountMinor / 100).toFixed(2) : "");
  const [employer, setEmployer] = useState(entry?.employer ?? lastEmployer);
  const [note, setNote] = useState(entry?.note ?? "");
  const add = useAction(addIncomeAction);
  const update = useAction(updateIncomeAction);
  const a = entry ? update : add;
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const base = { date, amount, employer: employer.trim() || null, note: note.trim() || null };
        const res = entry ? await update.run({ ...base, id: entry.id, expectedVersion: entry.version }) : await add.run({ ...base, idempotencyKey: idem });
        if (res?.ok) onDone();
      }}
      className="grid gap-3 sm:grid-cols-2"
    >
      <label className="space-y-1 text-sm">
        <span className="text-muted">Pay date</span>
        <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={field} />
      </label>
      <label className="space-y-1 text-sm">
        <span className="text-muted">Take-home (USD)</span>
        <input required inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} className={field} />
      </label>
      <label className="space-y-1 text-sm">
        <span className="text-muted">Employer</span>
        <input maxLength={120} value={employer} onChange={(e) => setEmployer(e.target.value)} className={field} />
      </label>
      <label className="space-y-1 text-sm">
        <span className="text-muted">Note (optional)</span>
        <input maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className={field} />
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button type="submit" disabled={a.pending} className="h-11 rounded-xl bg-forest-700 px-5 text-sm font-medium text-white disabled:opacity-60">
          {entry ? "Save paycheck" : "Add paycheck"}
        </button>
        <button type="button" onClick={onDone} className="h-11 px-3 text-sm text-muted">
          Cancel
        </button>
        <SaveStatus state={a.state} />
      </div>
    </form>
  );
}

function Row({ e, month, lastEmployer }: { e: Entry; month: string; lastEmployer: string }) {
  const [editing, setEditing] = useState(false);
  const del = useAction(deleteIncomeAction);
  if (editing) return <li className="py-3"><IncomeForm month={month} entry={e} lastEmployer={lastEmployer} onDone={() => setEditing(false)} /></li>;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div>
        <p className="font-medium">{e.employer || "Paycheck"}</p>
        <p className="text-sm text-muted">
          {e.date}
          {e.note ? ` · ${e.note}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-semibold tabular-nums">{formatUSD(e.amountMinor)}</span>
        <button onClick={() => setEditing(true)} className="h-9 rounded-lg px-3 text-sm text-forest-700 hover:bg-forest-50">
          Edit
        </button>
        <button disabled={del.pending} onClick={() => del.run({ id: e.id, expectedVersion: e.version })} className="h-9 rounded-lg px-3 text-sm text-danger hover:bg-danger-50">
          Delete
        </button>
        <SaveStatus state={del.state} />
      </div>
    </li>
  );
}

export function IncomePanel({ month, entries, lastEmployer }: { month: string; entries: Entry[]; lastEmployer: string }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-4">
      {entries.length > 0 && (
        <ul className="divide-y divide-line/70">
          {entries.map((e) => (
            <Row key={e.id} e={e} month={month} lastEmployer={lastEmployer} />
          ))}
        </ul>
      )}
      {adding ? (
        <IncomeForm month={month} entry={null} lastEmployer={lastEmployer} onDone={() => setAdding(false)} />
      ) : (
        <button onClick={() => setAdding(true)} className="h-11 rounded-xl border border-line bg-surface px-4 text-sm font-medium hover:bg-forest-50">
          + Add paycheck
        </button>
      )}
    </div>
  );
}
