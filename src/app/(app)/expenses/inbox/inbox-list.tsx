"use client";

import { Badge, Card, EmptyState } from "@/components/ui";
import { Collapsible } from "@/components/collapsible";
import { Select } from "@/components/select";
import { SaveStatus } from "@/components/save-status";
import { shortDate } from "@/engines/dates";
import { formatUSD } from "@/engines/money";
import { useAction } from "@/lib/client/use-action";
import { approveInboxAction, approveReadyAction, rejectInboxAction, setInboxCategoryAction } from "@/server/actions/inbox";

interface Row {
  id: string;
  date: string;
  description: string;
  amountMinor: number;
  currency: string;
  kind: "private" | "shared";
  categoryId: string | null;
  categoryName: string | null;
  groupName: string | null;
  paidBy: string | null;
  note: string | null;
  status: "pending" | "approved" | "rejected";
  blockers: string[];
  split: { person: string; owesMinor: number }[] | null;
}

const money = (r: Row) => (r.currency === "USD" ? formatUSD(r.amountMinor) : `${r.currency} ${(r.amountMinor / 100).toFixed(2)}`);

function PendingRow({ r, categories }: { r: Row; categories: { id: string; name: string }[] }) {
  const approve = useAction(approveInboxAction, { success: "Approved — it's in your expenses" });
  const reject = useAction(rejectInboxAction, { success: "Rejected" });
  const setCat = useAction(setInboxCategoryAction, { success: false });
  const busy = approve.pending || reject.pending || setCat.pending;
  return (
    <li className="space-y-3 py-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="break-words font-medium">{r.description}</p>
          <p className="text-sm text-muted">
            {shortDate(r.date)}
            {r.kind === "shared" && ` · Shared${r.groupName ? ` · ${r.groupName}` : ""}`}
            {r.note ? ` · ${r.note}` : ""}
          </p>
        </div>
        <p className="text-lg font-semibold tabular-nums">{money(r)}</p>
      </div>
      {r.kind === "shared" && r.split && (
        <p className="text-xs text-muted">
          {r.paidBy ? `${r.paidBy} paid · ` : ""}
          {r.split.map((s) => `${s.person} ${formatUSD(s.owesMinor)}`).join(" · ")}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          ariaLabel={`Category for ${r.description}`}
          value={r.categoryId ?? ""}
          onChange={(v) => v && void setCat.run({ id: r.id, categoryId: v })}
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
          placeholder={r.categoryName ? `Pick for “${r.categoryName}”` : "Choose category"}
          className="w-full min-w-44 sm:w-56"
        />
        <button
          disabled={busy || r.blockers.length > 0}
          onClick={() => void approve.run({ id: r.id })}
          className="h-11 flex-1 rounded-xl bg-forest-700 px-4 text-sm font-medium text-white transition hover:bg-forest-800 disabled:opacity-50 sm:flex-none"
        >
          Approve
        </button>
        <button disabled={busy} onClick={() => void reject.run({ id: r.id })} className="h-11 rounded-xl border border-line bg-surface px-4 text-sm font-medium transition hover:bg-forest-50 disabled:opacity-60">
          Reject
        </button>
      </div>
      {r.blockers.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {r.blockers.map((b) => (
            <Badge key={b} tone="warn">
              {b}
            </Badge>
          ))}
        </div>
      )}
      <SaveStatus state={approve.state.kind === "saved" ? { kind: "idle" } : approve.state} />
      <SaveStatus state={reject.state.kind === "saved" ? { kind: "idle" } : reject.state} />
      <SaveStatus state={setCat.state.kind === "saved" ? { kind: "idle" } : setCat.state} />
    </li>
  );
}

export function InboxList({ pending, recent, categories }: { pending: Row[]; recent: Row[]; categories: { id: string; name: string }[] }) {
  const all = useAction(approveReadyAction, { success: (d) => `Approved ${d.approved}${d.left ? ` · ${d.left} still need you` : ""}` });
  const ready = pending.filter((r) => r.blockers.length === 0).length;
  return (
    <div className="space-y-6">
      <Card
        title={`Waiting for you · ${pending.length}`}
        action={
          pending.length > 0 ? (
            <button disabled={all.pending || ready === 0} onClick={() => void all.run(undefined as never)} className="h-10 rounded-xl bg-forest-700 px-4 text-sm font-medium text-white transition hover:bg-forest-800 disabled:opacity-50">
              Approve all ready ({ready})
            </button>
          ) : undefined
        }
      >
        {pending.length === 0 ? (
          <EmptyState title="Nothing waiting">New expenses sent through the API show up here.</EmptyState>
        ) : (
          <ul className="divide-y divide-line/70">
            {pending.map((r) => (
              <PendingRow key={r.id} r={r} categories={categories} />
            ))}
          </ul>
        )}
        <SaveStatus state={all.state.kind === "saved" ? { kind: "idle" } : all.state} />
      </Card>

      {recent.length > 0 && (
        <Collapsible title="Recently decided" meta={`${recent.length}`}>
          <ul className="divide-y divide-line/70 text-sm">
            {recent.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="font-medium">{r.description}</span> <span className="text-muted">· {shortDate(r.date)}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums">{money(r)}</span>
                  <Badge tone={r.status === "approved" ? "forest" : "neutral"}>{r.status}</Badge>
                </span>
              </li>
            ))}
          </ul>
        </Collapsible>
      )}
    </div>
  );
}
