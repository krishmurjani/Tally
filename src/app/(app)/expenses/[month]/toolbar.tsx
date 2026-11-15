"use client";

import { useState } from "react";
import { SaveStatus } from "@/components/save-status";
import { formatUSD } from "@/engines/money";
import { useAction } from "@/lib/client/use-action";
import { acceptChangesAction, closeMonthAction, keepSnapshotAction, setMonthSourceAction, syncMonthAction } from "@/server/actions/expenses";

const btn = "h-11 rounded-xl px-4 text-sm font-medium disabled:opacity-60";

export function SyncButton({ month }: { month: string }) {
  const a = useAction(syncMonthAction);
  const [summary, setSummary] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        disabled={a.pending}
        onClick={async () => {
          const r = await a.run({ month });
          if (r?.ok) {
            const m = r.data.month;
            setSummary(`${m.fetched} fetched · ${m.inserted} new · ${m.updated} updated${m.missing ? ` · ${m.missing} missing` : ""}`);
          } else setSummary(null);
        }}
        className={`${btn} bg-forest-700 text-white hover:bg-forest-800`}
      >
        {a.pending ? "Syncing…" : "Sync Splitwise"}
      </button>
      <SaveStatus state={a.state.kind === "saved" ? { kind: "saved" } : a.state} />
      {summary && a.state.kind === "saved" && <span className="text-xs text-muted">{summary}</span>}
    </div>
  );
}

export function SourceSwitch({ month, source }: { month: string; source: "api" | "csv" | null }) {
  const a = useAction(setMonthSourceAction);
  const other = source === "csv" ? "api" : "csv";
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted">Source: {source === "api" ? "Splitwise sync" : source === "csv" ? "CSV import" : "not chosen"}</span>
      <button disabled={a.pending} onClick={() => a.run({ month, source: other })} className="font-medium text-forest-700 underline-offset-4 hover:underline">
        {source === null ? "Use CSV import" : `Switch to ${other === "csv" ? "CSV import" : "Splitwise sync"}`}
      </button>
      <SaveStatus state={a.state} />
    </div>
  );
}

export function CloseMonthButton({ month, version, blockers }: { month: string; version: number | null; blockers: number }) {
  const a = useAction(closeMonthAction);
  const [confirming, setConfirming] = useState(false);
  if (blockers > 0) {
    return <span className="text-sm text-muted">Resolve {blockers} item{blockers === 1 ? "" : "s"} below to close the month</span>;
  }
  if (!confirming) {
    return (
      <button onClick={() => setConfirming(true)} className={`${btn} border border-line bg-surface hover:bg-forest-50`}>
        Close month
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-2 text-sm">
      <span>Freeze this month&apos;s rows and totals?</span>
      <button disabled={a.pending} onClick={() => a.run({ month, expectedVersion: version })} className={`${btn} bg-forest-700 text-white`}>
        Yes, close
      </button>
      <button onClick={() => setConfirming(false)} className={`${btn} text-muted`}>
        Cancel
      </button>
      <SaveStatus state={a.state} />
    </div>
  );
}

interface DiffRow {
  key: string;
  date: string;
  description: string;
  shareMinor: number;
  status: string;
  category: string;
}

export function ChangesBanner({
  month,
  version,
  diff,
}: {
  month: string;
  version: number;
  diff: { added: DiffRow[]; removed: DiffRow[]; changed: { key: string; before: DiffRow; after: DiffRow; fields: { field: string; before: unknown; after: unknown }[] }[]; totalBeforeMinor: number; totalAfterMinor: number };
}) {
  const accept = useAction(acceptChangesAction);
  const keep = useAction(keepSnapshotAction);
  const fmt = (f: string, v: unknown) => (typeof v === "number" && /Minor$/.test(f) ? formatUSD(v) : String(v ?? "—"));
  return (
    <section role="alert" className="rounded-card border border-warn/30 bg-warn-50 p-5">
      <h2 className="font-semibold text-warn">Changed in Splitwise since you closed this month</h2>
      <p className="mt-1 text-sm">
        Closed total {formatUSD(diff.totalBeforeMinor)} → would now be {formatUSD(diff.totalAfterMinor)}. The month still shows the closed figures until you choose.
      </p>
      <ul className="mt-3 space-y-1 text-sm">
        {diff.added.map((r) => (
          <li key={`a${r.key}`}>
            <b>Added:</b> {r.date} {r.description} — {formatUSD(r.shareMinor)} ({r.status})
          </li>
        ))}
        {diff.removed.map((r) => (
          <li key={`r${r.key}`}>
            <b>Removed:</b> {r.date} {r.description} — {formatUSD(r.shareMinor)}
          </li>
        ))}
        {diff.changed.map((c) => (
          <li key={`c${c.key}`}>
            <b>Edited:</b> {c.after.description} —{" "}
            {c.fields
              .filter((f) => f.field !== "sourceVersion")
              .map((f) => `${f.field.replace("Minor", "")}: ${fmt(f.field, f.before)} → ${fmt(f.field, f.after)}`)
              .join("; ") || "edited in Splitwise (no change to amounts)"}
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button disabled={accept.pending} onClick={() => accept.run({ month, expectedVersion: version })} className={`${btn} bg-forest-700 text-white`}>
          Accept &amp; recompute
        </button>
        <button disabled={keep.pending} onClick={() => keep.run({ month, expectedVersion: version })} className={`${btn} border border-line bg-surface`}>
          Keep closed snapshot
        </button>
        <SaveStatus state={accept.state.kind !== "idle" ? accept.state : keep.state} />
      </div>
    </section>
  );
}
