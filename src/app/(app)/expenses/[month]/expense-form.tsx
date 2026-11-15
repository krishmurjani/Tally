"use client";

import { useMemo, useState } from "react";
import { Drawer } from "@/components/drawer";
import { SaveStatus } from "@/components/save-status";
import { Select } from "@/components/select";
import { useNewCategory } from "./new-category";
import { categoryTone } from "@/lib/category-colors";
import { monthBounds, todayNY } from "@/engines/dates";
import { formatUSD } from "@/engines/money";
import { newIdempotencyKey, useAction } from "@/lib/client/use-action";
import { addManualExpenseAction, deleteManualExpenseAction, updateManualExpenseAction } from "@/server/actions/expenses";

export interface ManualDraft {
  id: string;
  version: number;
  date: string;
  description: string;
  categoryId: string;
  amountMinor: number;
  note: string | null;
}

const field = "h-11 w-full rounded-xl border border-line bg-surface px-3 outline-none focus:border-forest-600";

export function ExpenseForm({
  month,
  categories,
  editing,
  onDone,
}: {
  month: string;
  categories: { id: string; name: string }[];
  editing: ManualDraft | null;
  onDone: () => void;
}) {
  const { start, end } = monthBounds(month);
  const today = todayNY();
  const newCategory = useNewCategory();
  const [idem] = useState(newIdempotencyKey);
  const [date, setDate] = useState(editing?.date ?? (today >= start && today <= end ? today : start));
  const [description, setDescription] = useState(editing?.description ?? "");
  const [categoryId, setCategoryId] = useState(editing?.categoryId ?? categories[0]?.id ?? "");
  const [amount, setAmount] = useState(editing ? (editing.amountMinor / 100).toFixed(2) : "");
  const [note, setNote] = useState(editing?.note ?? "");
  const add = useAction(addManualExpenseAction, { success: "Expense added" });
  const update = useAction(updateManualExpenseAction, { success: "Expense updated" });
  const del = useAction(deleteManualExpenseAction, { success: "Expense deleted" });
  const active = editing ? update : add;
  const negative = useMemo(() => amount.trim().startsWith("-"), [amount]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const base = { month, date, description, categoryId, amount, note: note.trim() || null };
    const res = editing
      ? await update.run({ ...base, id: editing.id, expectedVersion: editing.version })
      : await add.run({ ...base, idempotencyKey: idem });
    if (res?.ok) onDone();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block space-y-1 text-sm">
        <span className="text-muted">Date (within {month})</span>
        <input type="date" required min={start} max={end} value={date} onChange={(e) => setDate(e.target.value)} className={field} />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="text-muted">Description</span>
        <input required maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} className={field} />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="text-muted">Category</span>
        <Select ariaLabel="Category" onCreate={newCategory ? () => newCategory((id) => setCategoryId(id)) : undefined} value={categoryId} onChange={setCategoryId} options={categories.map((c) => ({ value: c.id, label: c.name, dot: categoryTone(c.name, categories.map((x) => x.name)).dot }))} />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="text-muted">Amount (USD) — use a minus sign for a refund</span>
        <input required inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} className={field} />
      </label>
      {negative && <p className="text-sm text-warn">This is a refund: it reduces this month&apos;s spending.</p>}
      <label className="block space-y-1 text-sm">
        <span className="text-muted">Note (optional)</span>
        <textarea maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className={`${field} h-20 py-2`} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={active.pending} className="h-11 rounded-xl bg-forest-700 px-5 text-sm font-medium text-white hover:bg-forest-800 disabled:opacity-60">
          {editing ? "Save changes" : "Add expense"}
        </button>
        <SaveStatus state={active.state} />
      </div>
      {editing && (
        <div className="border-t border-line pt-4">
          <button
            type="button"
            disabled={del.pending}
            onClick={async () => {
              const res = await del.run({ id: editing.id, expectedVersion: editing.version });
              if (res?.ok) onDone();
            }}
            className="h-11 rounded-xl border border-danger/30 px-4 text-sm text-danger hover:bg-danger-50"
          >
            Delete this {formatUSD(editing.amountMinor)} expense
          </button>
          <SaveStatus state={del.state} />
        </div>
      )}
    </form>
  );
}

export function AddExpenseButton({ month, categories }: { month: string; categories: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="inline-flex h-11 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-medium transition hover:bg-forest-50">
        <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M10 4.5v11M4.5 10h11" />
        </svg>
        Add expense
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title="Add expense">
        {open && <ExpenseForm month={month} categories={categories} editing={null} onDone={() => setOpen(false)} />}
      </Drawer>
    </>
  );
}
