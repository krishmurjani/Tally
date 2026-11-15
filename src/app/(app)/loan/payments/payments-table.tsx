"use client";

import { useState } from "react";
import { Drawer } from "@/components/drawer";
import { SaveStatus } from "@/components/save-status";
import { Badge } from "@/components/ui";
import { todayNY } from "@/engines/dates";
import { effectiveStatus, PAYMENT_TYPE_LABEL, type LenderPaymentStatus } from "@/engines/loan/ledger";
import { formatINR } from "@/engines/money";
import { newIdempotencyKey, useAction } from "@/lib/client/use-action";
import { addPaymentAction, deletePaymentAction, markPaymentPaidAction, updatePaymentAction } from "@/server/actions/loan";
import type { PaymentRecord } from "@/server/repos/loan";

const PAYER: Record<string, string> = { krish: "Me", sister: "Sister", other: "Other" };
const STATUS_TONE: Record<LenderPaymentStatus, "forest" | "neutral" | "danger" | "warn"> = { paid: "forest", planned: "neutral", overdue: "danger", bounced: "warn" };
const field = "h-11 w-full rounded-xl border border-line bg-surface px-3 outline-none focus:border-forest-600";
const rupees = (m: number | null) => (m === null ? "" : m % 100 === 0 ? String(m / 100) : (m / 100).toFixed(2));

function PaymentForm({ payment, onDone }: { payment: PaymentRecord | null; onDone: () => void }) {
  const [idem] = useState(newIdempotencyKey);
  const [v, setV] = useState({
    dueDate: payment?.dueDate ?? todayNY(),
    paidDate: payment?.paidDate ?? "",
    amount: rupees(payment?.amountMinor ?? null),
    payer: payment?.payer ?? "krish",
    type: payment?.type ?? "pmii_emi",
    status: payment?.status ?? "planned",
    reference: payment?.reference ?? "",
    note: payment?.note ?? "",
    interest: rupees(payment?.interestMinor ?? null),
    principal: rupees(payment?.principalMinor ?? null),
  });
  const add = useAction(addPaymentAction);
  const upd = useAction(updatePaymentAction);
  const a = payment ? upd : add;
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const body = {
          ...v,
          paidDate: v.paidDate || null,
          payer: v.type === "bounce" ? null : v.payer,
          reference: v.reference.trim() || null,
          note: v.note.trim() || null,
        };
        const r = payment ? await upd.run({ ...body, id: payment.id, expectedVersion: payment.version }) : await add.run({ ...body, idempotencyKey: idem });
        if (r?.ok) onDone();
      }}
      className="space-y-4 text-sm"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-muted">Due date</span>
          <input type="date" required value={v.dueDate} onChange={set("dueDate")} className={field} />
        </label>
        <label className="space-y-1">
          <span className="text-muted">Amount (₹)</span>
          <input required inputMode="decimal" value={v.amount} onChange={set("amount")} className={field} />
        </label>
        <label className="space-y-1">
          <span className="text-muted">Type</span>
          <select value={v.type} onChange={(e) => setV((s) => ({ ...s, type: e.target.value as typeof s.type, status: e.target.value === "bounce" ? "bounced" : s.status === "bounced" ? "planned" : s.status }))} className={field}>
            <option value="pmii_emi">PMII/EMI</option>
            <option value="repayment">Repayment</option>
            <option value="bounce">Bounce (audit only)</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-muted">Status</span>
          <select value={v.status} onChange={set("status")} disabled={v.type === "bounce"} className={field}>
            <option value="planned">Planned</option>
            <option value="paid">Paid</option>
            <option value="bounced" disabled={v.type !== "bounce"}>
              Bounced
            </option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-muted">Paid date {v.status === "paid" ? "(required)" : ""}</span>
          <input type="date" value={v.paidDate} onChange={set("paidDate")} disabled={v.status !== "paid"} className={field} />
        </label>
        <label className="space-y-1">
          <span className="text-muted">Paid by</span>
          <select value={v.payer ?? "krish"} onChange={set("payer")} disabled={v.type === "bounce"} className={field}>
            <option value="krish">Me</option>
            <option value="sister">Sister</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-muted">Reference</span>
          <input value={v.reference} onChange={set("reference")} maxLength={120} className={field} />
        </label>
        <label className="space-y-1">
          <span className="text-muted">Note</span>
          <input value={v.note} onChange={set("note")} maxLength={500} className={field} />
        </label>
      </div>
      <fieldset className="rounded-xl border border-line p-3">
        <legend className="px-1 text-muted">Lender allocation (optional — only if the lender told you)</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-muted">Interest (₹)</span>
            <input inputMode="decimal" value={v.interest} onChange={set("interest")} className={field} />
          </label>
          <label className="space-y-1">
            <span className="text-muted">Principal (₹)</span>
            <input inputMode="decimal" value={v.principal} onChange={set("principal")} className={field} />
          </label>
        </div>
      </fieldset>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={a.pending} className="h-11 rounded-xl bg-forest-700 px-5 font-medium text-white disabled:opacity-60">
          {payment ? "Save payment" : "Add payment"}
        </button>
        <SaveStatus state={a.state} />
      </div>
    </form>
  );
}

function MarkPaid({ p }: { p: PaymentRecord }) {
  const [date, setDate] = useState(todayNY());
  const a = useAction(markPaymentPaidAction);
  return (
    <span className="flex flex-wrap items-center gap-1">
      <input type="date" aria-label="Paid on" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 rounded-lg border border-line px-2 text-sm" />
      <button disabled={a.pending} onClick={() => a.run({ id: p.id, expectedVersion: p.version, paidDate: date, payer: p.payer ?? "krish" })} className="h-9 rounded-lg bg-forest-700 px-3 text-sm text-white">
        Mark paid
      </button>
      <SaveStatus state={a.state} />
    </span>
  );
}

export function PaymentsTable({ payments }: { payments: PaymentRecord[] }) {
  const today = todayNY();
  const [editing, setEditing] = useState<PaymentRecord | "new" | null>(null);
  const [payer, setPayer] = useState("");
  const [status, setStatus] = useState("");
  const del = useAction(deletePaymentAction);
  const rows = payments
    .map((p) => ({ p, st: effectiveStatus(p, today) }))
    .filter(({ p, st }) => (!payer || (p.payer ?? "none") === payer) && (!status || st === status))
    .sort((a, b) => (a.p.dueDate < b.p.dueDate ? 1 : -1));
  const sel = "h-11 rounded-xl border border-line bg-surface px-3 text-sm";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Filter by payer" value={payer} onChange={(e) => setPayer(e.target.value)} className={sel}>
          <option value="">Everyone</option>
          <option value="krish">Me</option>
          <option value="sister">Sister</option>
          <option value="other">Other</option>
        </select>
        <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className={sel}>
          <option value="">All statuses</option>
          <option value="paid">Paid</option>
          <option value="planned">Planned</option>
          <option value="overdue">Overdue</option>
          <option value="bounced">Bounced</option>
        </select>
        <button onClick={() => setEditing("new")} className="ml-auto h-11 rounded-xl border border-line bg-surface px-4 text-sm font-medium hover:bg-forest-50">
          + Add payment
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-faint">
            <tr className="border-b border-line">
              <th className="py-2 pr-3 font-medium">Due</th>
              <th className="py-2 pr-3 font-medium">Paid</th>
              <th className="py-2 pr-3 text-right font-medium">Amount</th>
              <th className="py-2 pr-3 font-medium">Paid by</th>
              <th className="py-2 pr-3 font-medium">Type</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 pr-3 font-medium">Allocation</th>
              <th className="py-2 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, st }) => (
              <tr key={p.id} className={`border-b border-line/60 ${st === "bounced" ? "text-muted" : ""}`}>
                <td className="py-2 pr-3 tabular-nums">{p.dueDate}</td>
                <td className="py-2 pr-3 tabular-nums">{p.paidDate ?? "—"}</td>
                <td className={`py-2 pr-3 text-right tabular-nums ${st === "bounced" ? "line-through" : "font-medium"}`}>{formatINR(p.amountMinor)}</td>
                <td className="py-2 pr-3">{p.payer ? PAYER[p.payer] : "—"}</td>
                <td className="py-2 pr-3">{PAYMENT_TYPE_LABEL[p.type]}</td>
                <td className="py-2 pr-3">
                  <Badge tone={STATUS_TONE[st]}>{st === "bounced" ? "Bounced · excluded" : st[0]!.toUpperCase() + st.slice(1)}</Badge>
                </td>
                <td className="py-2 pr-3 text-muted">
                  {p.interestMinor === null ? "Not entered" : `${formatINR(p.interestMinor)} interest · ${formatINR(p.principalMinor!)} principal`}
                </td>
                <td className="py-2">
                  <span className="flex flex-wrap items-center gap-1">
                    {(st === "planned" || st === "overdue") && <MarkPaid p={p} />}
                    <button onClick={() => setEditing(p)} className="h-9 rounded-lg px-3 text-forest-700 hover:bg-forest-50">
                      Edit
                    </button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p className="py-4 text-center text-sm text-muted">No payments match.</p>}
      <Drawer open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Add lender payment" : "Edit lender payment"}>
        {editing !== null && (
          <>
            <PaymentForm key={editing === "new" ? "new" : editing.id} payment={editing === "new" ? null : editing} onDone={() => setEditing(null)} />
            {editing !== "new" && (
              <div className="mt-6 border-t border-line pt-4">
                <button
                  disabled={del.pending}
                  onClick={async () => {
                    const r = await del.run({ id: editing.id, expectedVersion: editing.version });
                    if (r?.ok) setEditing(null);
                  }}
                  className="h-11 rounded-xl border border-danger/30 px-4 text-sm text-danger hover:bg-danger-50"
                >
                  Delete this {formatINR(editing.amountMinor)} payment
                </button>
                <SaveStatus state={del.state} />
              </div>
            )}
          </>
        )}
      </Drawer>
    </div>
  );
}
