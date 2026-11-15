"use client";

import { useState } from "react";
import { Drawer } from "@/components/drawer";
import { Select } from "@/components/select";
import { SaveStatus } from "@/components/save-status";
import { Badge } from "@/components/ui";
import { shortDate, todayNY } from "@/engines/dates";
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
  const add = useAction(addPaymentAction, { success: "Payment added" });
  const upd = useAction(updatePaymentAction, { success: "Payment updated" });
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
          <Select
            ariaLabel="Type"
            value={v.type}
            onChange={(t) => setV((s) => ({ ...s, type: t as typeof s.type, status: t === "bounce" ? "bounced" : s.status === "bounced" ? "planned" : s.status }))}
            options={[
              { value: "pmii_emi", label: "PMII/EMI" },
              { value: "repayment", label: "Repayment" },
              { value: "bounce", label: "Bounce (audit only)" },
            ]}
          />
        </label>
        <label className="space-y-1">
          <span className="text-muted">Status</span>
          <Select
            ariaLabel="Status"
            value={v.status}
            disabled={v.type === "bounce"}
            onChange={(st) => setV((s) => ({ ...s, status: st as typeof s.status }))}
            options={[
              { value: "planned", label: "Planned" },
              { value: "paid", label: "Paid" },
              { value: "bounced", label: "Bounced", disabled: v.type !== "bounce" },
            ]}
          />
        </label>
        <label className="space-y-1">
          <span className="text-muted">Paid date {v.status === "paid" ? "(required)" : ""}</span>
          <input type="date" value={v.paidDate} onChange={set("paidDate")} disabled={v.status !== "paid"} className={field} />
        </label>
        <label className="space-y-1">
          <span className="text-muted">Paid by</span>
          <Select
            ariaLabel="Paid by"
            value={v.payer ?? "krish"}
            disabled={v.type === "bounce"}
            onChange={(pv) => setV((s) => ({ ...s, payer: pv as typeof s.payer }))}
            options={[
              { value: "krish", label: "Me" },
              { value: "sister", label: "Sister" },
              { value: "other", label: "Other" },
            ]}
          />
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
  const a = useAction(markPaymentPaidAction, { success: "Marked as paid" });
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
  const del = useAction(deletePaymentAction, { success: "Payment deleted" });
  const rows = payments
    .map((p) => ({ p, st: effectiveStatus(p, today) }))
    .filter(({ p, st }) => (!payer || (p.payer ?? "none") === payer) && (!status || st === status))
    .sort((a, b) => (a.p.dueDate < b.p.dueDate ? 1 : -1));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          ariaLabel="Filter by payer"
          value={payer}
          onChange={setPayer}
          className="min-w-36 flex-1 sm:w-44 sm:flex-none"
          options={[
            { value: "", label: "Everyone" },
            { value: "krish", label: "Me" },
            { value: "sister", label: "Sister" },
            { value: "other", label: "Other" },
          ]}
        />
        <Select
          ariaLabel="Filter by status"
          value={status}
          onChange={setStatus}
          className="min-w-36 flex-1 sm:w-44 sm:flex-none"
          options={[
            { value: "", label: "All statuses" },
            { value: "paid", label: "Paid" },
            { value: "planned", label: "Planned" },
            { value: "overdue", label: "Overdue" },
            { value: "bounced", label: "Bounced" },
          ]}
        />
        <button onClick={() => setEditing("new")} className="h-11 w-full rounded-xl border border-line bg-surface px-4 text-sm font-medium hover:bg-forest-50 sm:ml-auto sm:w-auto">
          + Add payment
        </button>
      </div>
      {/* Phones and tablets: one card per payment. Wide screens: the table. */}
      <ul className="space-y-2 lg:hidden">
        {rows.map(({ p, st }) => (
          <li key={p.id} className={`rounded-2xl border border-line bg-surface p-4 ${st === "bounced" ? "text-muted" : ""}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium tabular-nums">Due {shortDate(p.dueDate)}</p>
                <p className="text-xs text-muted">{p.paidDate ? `Paid ${shortDate(p.paidDate)}` : "Not paid yet"}</p>
              </div>
              <p className={`text-lg tabular-nums ${st === "bounced" ? "line-through" : "font-semibold"}`}>{formatINR(p.amountMinor)}</p>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
              <Badge tone={STATUS_TONE[st]}>{st === "bounced" ? "Bounced · excluded" : st[0]!.toUpperCase() + st.slice(1)}</Badge>
              <Badge>{PAYMENT_TYPE_LABEL[p.type]}</Badge>
              {p.payer && <Badge>{PAYER[p.payer]}</Badge>}
            </div>
            <p className="mt-2 text-xs text-muted">{p.interestMinor === null ? "Allocation not entered" : `${formatINR(p.interestMinor)} interest · ${formatINR(p.principalMinor!)} principal`}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {(st === "planned" || st === "overdue") && <MarkPaid p={p} />}
              <button onClick={() => setEditing(p)} className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-sm font-medium hover:bg-forest-50">
                Edit
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full text-sm">
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
