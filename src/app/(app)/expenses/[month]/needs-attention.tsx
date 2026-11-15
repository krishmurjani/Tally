"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Usd } from "@/components/money";
import { SaveStatus } from "@/components/save-status";
import { Select } from "@/components/select";
import { Badge } from "@/components/ui";
import { shortDate } from "@/engines/dates";
import { formatUSD } from "@/engines/money";
import type { DisplayRow } from "@/server/month-data";
import { categoryTone } from "@/lib/category-colors";
import { newIdempotencyKey, useAction } from "@/lib/client/use-action";
import { markNotExpenseBulkAction, setCategoryBulkAction, setLargeDismissedAction } from "@/server/actions/expenses";
import { useNewCategory } from "./new-category";
import { RowDrawer, statusLabel } from "./transactions";

function DismissLarge({ rowKey }: { rowKey: string }) {
  const a = useAction(setLargeDismissedAction, { success: "Dismissed — you can bring it back from the expense" });
  return (
    <button disabled={a.pending} onClick={() => a.run({ rowKey, dismissed: true })} title="This is expected — stop flagging this expense" className="h-9 shrink-0 rounded-lg border border-line px-3 text-sm text-muted hover:bg-forest-50 hover:text-forest-800 disabled:opacity-60">
      {a.pending ? "…" : "Dismiss"}
    </button>
  );
}

export function NeedsAttention({
  rows,
  pendingDecisions,
  categories,
  month,
  closed,
}: {
  rows: DisplayRow[];
  pendingDecisions: { id: string; reason: string | null; spec: { date: string; description: string; costMinor: number; group?: string | null } }[];
  categories: { id: string; name: string }[];
  month: string;
  closed: boolean;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirmNot, setConfirmNot] = useState(false);
  const newCategory = useNewCategory();
  const [reason, setReason] = useState("");
  const [idem, setIdem] = useState(newIdempotencyKey);
  const bulkCat = useAction(setCategoryBulkAction, { success: (d) => `Category set on ${d.updated} expense${d.updated === 1 ? "" : "s"}` });
  const bulkNot = useAction(markNotExpenseBulkAction, { success: (d) => `${d.marked} marked as not an expense${d.skipped ? ` · ${d.skipped} already decided` : ""}` });
  const items = rows.filter((r) => r.status === "review" || r.flags.includes("needs_category") || r.flags.includes("large"));
  const open = rows.find((r) => r.key === openKey) ?? null;
  const itemKeys = items.map((r) => r.key);
  // Keep only selections that are still in the list (rows leave it once handled).
  const selected = itemKeys.filter((k) => picked.has(k));
  const allSelected = items.length > 0 && selected.length === items.length;
  const toggle = (key: string) =>
    setPicked((p) => {
      const n = new Set(p);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  const canBulk = !closed && items.length > 1;
  if (!items.length && !pendingDecisions.length) {
    return <p className="text-sm text-forest-700">Nothing needs your attention this month.</p>;
  }
  const why = (r: DisplayRow) =>
    r.status === "review" ? r.reasonText : r.flags.includes("needs_category") ? (r.suggestion ? `Needs category — suggestion: ${r.suggestion}` : `Needs category (Splitwise: ${r.sourceCategory ?? "none"})`) : "Large expense";
  const order = categories.map((c) => c.name);
  return (
    <>
      {canBulk && (
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-forest-50/70 px-3 py-2">
          <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium">
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = selected.length > 0 && !allSelected;
              }}
              onChange={() => setPicked(allSelected ? new Set() : new Set(itemKeys))}
              className="size-4 accent-forest-700"
            />
            {selected.length ? `${selected.length} selected` : "Select all"}
          </label>
          {selected.length > 0 && (
            <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
              <Select
                onCreate={newCategory ? () => newCategory(async (id) => { const r = await bulkCat.run({ rowKeys: selected, categoryId: id }); if (r?.ok) setPicked(new Set()); }) : undefined}
                ariaLabel="Set category for selected"
                value=""
                placeholder="Set category…"
                size="md"
                className="w-48"
                disabled={bulkCat.pending}
                options={categories.map((c) => ({ value: c.id, label: c.name, dot: categoryTone(c.name, order).dot }))}
                onChange={async (id) => {
                  const r = await bulkCat.run({ rowKeys: selected, categoryId: id });
                  if (r?.ok) setPicked(new Set());
                }}
              />
              <button
                onClick={() => {
                  setIdem(newIdempotencyKey());
                  setReason("");
                  setConfirmNot(true);
                }}
                className="inline-flex h-11 items-center rounded-xl border border-line bg-surface px-4 text-sm font-medium transition hover:bg-forest-50"
              >
                Not an expense
              </button>
              <button onClick={() => setPicked(new Set())} className="inline-flex h-11 items-center rounded-xl px-3 text-sm text-muted transition hover:text-ink">
                Clear
              </button>
            </div>
          )}
          {bulkCat.state.kind === "failed" && <SaveStatus state={bulkCat.state} />}
        </div>
      )}
      <ul className="divide-y divide-line/70">
        {items.map((r) => {
          const s = statusLabel(r);
          return (
            <li key={r.key} className={`flex items-center gap-1 transition ${picked.has(r.key) ? "bg-forest-50/50" : ""}`}>
              {canBulk && (
                <label className="grid size-11 shrink-0 cursor-pointer place-items-center">
                  <input type="checkbox" checked={picked.has(r.key)} onChange={() => toggle(r.key)} aria-label={`Select ${r.description}`} className="size-4 accent-forest-700" />
                </label>
              )}
              <button onClick={() => setOpenKey(r.key)} className="flex min-w-0 flex-1 items-center justify-between gap-3 py-3 text-left hover:bg-forest-50/50">
                <div className="min-w-0">
                  <p className="truncate font-medium">{r.description}</p>
                  <p className="text-sm text-muted">
                    {shortDate(r.date)} · {why(r)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {r.flags.includes("large") && r.status === "included" && !r.flags.includes("needs_category") ? <Badge tone="warn">Large</Badge> : <Badge tone={s.tone}>{s.text}</Badge>}
                  <Usd minor={r.status === "included" ? r.shareMinor : 0} className="font-semibold" />
                </div>
              </button>
              {!closed && r.status === "included" && r.flags.includes("large") && !r.flags.includes("needs_category") && <DismissLarge rowKey={r.key} />}
            </li>
          );
        })}
        {pendingDecisions.map((d) => (
          <li key={d.id} className="py-3">
            <p className="font-medium">Saved decision not matched yet</p>
            <p className="text-sm text-muted">
              {shortDate(d.spec.date)} “{d.spec.description}” {formatUSD(d.spec.costMinor)}
              {d.spec.group ? ` (${d.spec.group})` : ""} — {d.reason}. It will be matched when this month&apos;s data is synced or imported; if no unique match exists it stays here.
            </p>
          </li>
        ))}
      </ul>
      <RowDrawer row={open} categories={categories} month={month} closed={closed} onClose={() => setOpenKey(null)} />
      <ConfirmDialog
        open={confirmNot}
        title={`Mark ${selected.length} expense${selected.length === 1 ? "" : "s"} as not an expense?`}
        confirmLabel="Mark as not an expense"
        busy={bulkNot.pending}
        error={bulkNot.state.kind === "failed" ? <SaveStatus state={bulkNot.state} /> : null}
        onCancel={() => {
          setConfirmNot(false);
          bulkNot.reset();
        }}
        onConfirm={async () => {
          const r = await bulkNot.run({ rowKeys: selected, reason: reason.trim() || null, idempotencyKey: idem });
          if (r?.ok) {
            setConfirmNot(false);
            setPicked(new Set());
          }
        }}
      >
        <p>They'll be left out of your spending. Each one is decided on its own, with no rule for similar ones, and you can undo any of them later.</p>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" aria-label="Reason" maxLength={300} className="mt-3 h-11 w-full rounded-xl border border-line bg-surface px-3 text-ink outline-none focus:border-forest-600" />
      </ConfirmDialog>
    </>
  );
}
