"use client";

import { useState } from "react";
import { Usd } from "@/components/money";
import { Badge } from "@/components/ui";
import { shortDate } from "@/engines/dates";
import { formatUSD } from "@/engines/money";
import type { DisplayRow } from "@/server/month-data";
import { useAction } from "@/lib/client/use-action";
import { setLargeDismissedAction } from "@/server/actions/expenses";
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
  const items = rows.filter((r) => r.status === "review" || r.flags.includes("needs_category") || r.flags.includes("large"));
  const open = rows.find((r) => r.key === openKey) ?? null;
  if (!items.length && !pendingDecisions.length) {
    return <p className="text-sm text-forest-700">Nothing needs your attention this month.</p>;
  }
  const why = (r: DisplayRow) =>
    r.status === "review" ? r.reasonText : r.flags.includes("needs_category") ? (r.suggestion ? `Needs category — suggestion: ${r.suggestion}` : `Needs category (Splitwise: ${r.sourceCategory ?? "none"})`) : "Large expense";
  return (
    <>
      <ul className="divide-y divide-line/70">
        {items.map((r) => {
          const s = statusLabel(r);
          return (
            <li key={r.key} className="flex items-center gap-2">
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
    </>
  );
}
