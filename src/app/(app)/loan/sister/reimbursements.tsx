"use client";

import { useState } from "react";
import { SaveStatus } from "@/components/save-status";
import { Badge } from "@/components/ui";
import { todayNY } from "@/engines/dates";
import { formatINR } from "@/engines/money";
import { newIdempotencyKey, useAction } from "@/lib/client/use-action";
import { addReimbursementAction, deleteReimbursementAction, updateReimbursementAction } from "@/server/actions/loan";
import type { ReimbursementRecord } from "@/server/repos/loan";

const field = "h-11 rounded-xl border border-line bg-surface px-3 outline-none focus:border-forest-600";

function Form({ entry, onDone }: { entry: ReimbursementRecord | null; onDone: () => void }) {
  const [idem] = useState(newIdempotencyKey);
  const [date, setDate] = useState(entry?.date ?? todayNY());
  const [amount, setAmount] = useState(entry ? String(entry.amountMinor / 100) : "");
  const [note, setNote] = useState(entry?.note ?? "");
  const add = useAction(addReimbursementAction, { success: "Reimbursement recorded" });
  const upd = useAction(updateReimbursementAction, { success: "Reimbursement updated" });
  const a = entry ? upd : add;
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const body = { date, amount, note: note.trim() || null };
        const r = entry ? await upd.run({ ...body, id: entry.id, expectedVersion: entry.version }) : await add.run({ ...body, idempotencyKey: idem });
        if (r?.ok) onDone();
      }}
      className="flex flex-wrap items-end gap-2 text-sm"
    >
      <label className="space-y-1">
        <span className="block text-muted">Date</span>
        <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={field} />
      </label>
      <label className="space-y-1">
        <span className="block text-muted">Amount (₹)</span>
        <input required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${field} w-36`} />
      </label>
      <label className="min-w-40 flex-1 space-y-1">
        <span className="block text-muted">Note</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={`${field} w-full`} />
      </label>
      <button type="submit" disabled={a.pending} className="h-11 rounded-xl bg-forest-700 px-4 font-medium text-white disabled:opacity-60">
        {entry ? "Save" : "Add reimbursement"}
      </button>
      <button type="button" onClick={onDone} className="h-11 px-2 text-muted">
        Cancel
      </button>
      <SaveStatus state={a.state} />
    </form>
  );
}

function Row({ r }: { r: ReimbursementRecord }) {
  const [editing, setEditing] = useState(false);
  const del = useAction(deleteReimbursementAction, { success: "Reimbursement deleted" });
  if (editing) return <li className="py-3"><Form entry={r} onDone={() => setEditing(false)} /></li>;
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
      <span>
        {r.date} {r.kind === "opening" && <Badge>opening reconciliation</Badge>} {r.note && <span className="text-muted">· {r.note}</span>}
      </span>
      <span className="flex items-center gap-1">
        <span className="mr-2 font-medium tabular-nums">{formatINR(r.amountMinor)}</span>
        <button onClick={() => setEditing(true)} className="h-9 rounded-lg px-3 text-brand hover:bg-forest-50">
          Edit
        </button>
        <button disabled={del.pending} onClick={() => del.run({ id: r.id, expectedVersion: r.version })} className="h-9 rounded-lg px-3 text-danger hover:bg-danger-50">
          Delete
        </button>
        <SaveStatus state={del.state} />
      </span>
    </li>
  );
}

export function Reimbursements({ entries }: { entries: ReimbursementRecord[] }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-line/70">
        {entries.map((r) => (
          <Row key={r.id} r={r} />
        ))}
      </ul>
      {adding ? (
        <Form entry={null} onDone={() => setAdding(false)} />
      ) : (
        <button onClick={() => setAdding(true)} className="h-11 rounded-xl border border-line bg-surface px-4 text-sm font-medium hover:bg-forest-50">
          + Record a reimbursement
        </button>
      )}
    </div>
  );
}
