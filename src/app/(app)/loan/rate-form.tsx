"use client";

import { useState } from "react";
import { SaveStatus } from "@/components/save-status";
import { todayNY } from "@/engines/dates";
import { useAction } from "@/lib/client/use-action";
import { addRateChangeAction } from "@/server/actions/loan";

export function RateForm() {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(todayNY());
  const [rate, setRate] = useState("");
  const [note, setNote] = useState("");
  const a = useAction(addRateChangeAction, { success: "Rate change recorded" });
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="h-10 rounded-lg px-3 text-sm font-medium text-brand hover:bg-forest-50">
        + Record a rate change
      </button>
    );
  }
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await a.run({ effectiveFrom: date, annualPercent: rate, note: note.trim() || null });
        if (r?.ok) setOpen(false);
      }}
      className="flex flex-wrap items-end gap-2 text-sm"
    >
      <label className="space-y-1">
        <span className="block text-muted">Effective from</span>
        <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className="h-11 rounded-xl border border-line px-3" />
      </label>
      <label className="space-y-1">
        <span className="block text-muted">Annual rate %</span>
        <input required inputMode="decimal" placeholder="11.55" value={rate} onChange={(e) => setRate(e.target.value)} className="h-11 w-28 rounded-xl border border-line px-3" />
      </label>
      <label className="space-y-1">
        <span className="block text-muted">Note</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className="h-11 rounded-xl border border-line px-3" />
      </label>
      <button type="submit" disabled={a.pending} className="h-11 rounded-xl bg-forest-700 px-4 font-medium text-white disabled:opacity-60">
        Save
      </button>
      <button type="button" onClick={() => setOpen(false)} className="h-11 px-2 text-muted">
        Cancel
      </button>
      <SaveStatus state={a.state} />
    </form>
  );
}
