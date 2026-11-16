"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SaveStatus } from "@/components/save-status";
import { monthLabel } from "@/engines/dates";
import { formatUSD } from "@/engines/money";
import { useAction } from "@/lib/client/use-action";
import { acceptChangesAction, closeMonthAction, keepSnapshotAction, reopenMonthAction, setMonthSourceAction, syncMonthAction } from "@/server/actions/expenses";

const btn = "inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition disabled:opacity-60";
export const btnPrimary = `${btn} bg-forest-700 text-white hover:bg-forest-800`;
export const btnSecondary = `${btn} border border-line bg-surface hover:bg-forest-50`;

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

export function SyncButton({ month }: { month: string }) {
  const a = useAction(syncMonthAction, {
    success: (d) => {
      const m = d.month;
      const parts = [`${m.fetched} fetched`, `${m.inserted} new`, `${m.updated} updated`];
      if (m.missing) parts.push(`${m.missing} missing`);
      return `Synced ${monthLabel(month)} · ${parts.join(" · ")}`;
    },
  });
  return (
    <div className="relative col-span-2 sm:col-span-1">
      <button disabled={a.pending} onClick={() => a.run({ month })} className={`${btnPrimary} w-full sm:w-auto`}>
        <span className={a.pending ? "animate-spin" : ""}>
          <Icon>
            <path d="M16.5 10a6.5 6.5 0 1 1-2-4.7" />
            <path d="M16.5 3.5v3.3h-3.3" />
          </Icon>
        </span>
        {a.pending ? "Syncing…" : "Sync Splitwise"}
      </button>
      {a.state.kind === "failed" && (
        <div className="absolute right-0 top-full z-10 mt-1.5 w-72">
          <SaveStatus state={a.state} />
        </div>
      )}
    </div>
  );
}

/** Two-option segmented control. The highlight slides and resizes to fit each label exactly. */
export function SourceSwitch({ month, source }: { month: string; source: "api" | "csv" | null }) {
  const a = useAction(setMonthSourceAction, { success: "Data source updated" });
  const opts = [
    ["api", "Splitwise sync"],
    ["csv", "CSV import"],
  ] as const;
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const measure = () => {
      const el = source ? refs.current[source] : null;
      setBox(el ? { left: el.offsetLeft, width: el.offsetWidth } : null);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [source]);
  // Don't animate the very first placement, only later switches.
  useEffect(() => {
    const t = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(t);
  }, []);
  return (
    <div className="flex flex-col items-stretch gap-1.5 sm:items-start">
      <div role="radiogroup" aria-label="Data source for this month" title={source === null ? "Choose where this month's data comes from" : undefined} className="relative flex h-11 w-full items-stretch gap-0.5 rounded-xl border border-line bg-surface p-1 text-sm sm:inline-flex sm:w-fit">
        {box && (
          <span
            aria-hidden="true"
            className={`absolute inset-y-1 rounded-lg bg-forest-700 shadow-sm motion-reduce:transition-none ${ready ? "transition-[left,width] duration-300 ease-[cubic-bezier(0.34,1.3,0.5,1)]" : ""}`}
            style={{ left: box.left, width: box.width }}
          />
        )}
        {opts.map(([value, label]) => {
          const active = source === value;
          return (
            <button
              key={value}
              ref={(el) => {
                refs.current[value] = el;
              }}
              role="radio"
              aria-checked={active}
              disabled={a.pending}
              onClick={() => !active && a.run({ month, source: value })}
              className={`relative z-10 flex-1 whitespace-nowrap rounded-lg px-4 font-medium transition-colors duration-200 sm:flex-none ${active ? "text-white" : "text-muted hover:text-brand-strong"}`}
            >
              {label}
            </button>
          );
        })}
      </div>
      {a.state.kind === "failed" && <SaveStatus state={a.state} />}
    </div>
  );
}

export function CloseMonthButton({ month, version, blockers }: { month: string; version: number | null; blockers: number }) {
  const a = useAction(closeMonthAction, { success: () => `${monthLabel(month)} closed` });
  const [confirming, setConfirming] = useState(false);
  if (blockers > 0) {
    return (
      <span className="col-span-2 inline-flex min-h-11 items-center gap-2 rounded-xl border border-warn/25 bg-warn-50 px-3 text-sm text-warn sm:col-span-1">
        <Icon>
          <rect x="4.5" y="9" width="11" height="7.5" rx="1.5" />
          <path d="M7 9V6.8a3 3 0 0 1 6 0V9" />
        </Icon>
        Resolve {blockers} item{blockers === 1 ? "" : "s"} to close
      </span>
    );
  }
  return (
    <>
      <button onClick={() => setConfirming(true)} className={btnSecondary}>
        <Icon>
          <rect x="4.5" y="9" width="11" height="7.5" rx="1.5" />
          <path d="M7 9V6.8a3 3 0 0 1 6 0V9" />
        </Icon>
        Close month
      </button>
      <ConfirmDialog
        open={confirming}
        title={`Close ${monthLabel(month)}?`}
        confirmLabel="Close month"
        busy={a.pending}
        error={a.state.kind === "failed" ? <SaveStatus state={a.state} /> : null}
        onCancel={() => {
          setConfirming(false);
          a.reset();
        }}
        onConfirm={async () => {
          const r = await a.run({ month, expectedVersion: version });
          if (r?.ok) setConfirming(false);
        }}
      >
        This freezes the month&apos;s rows, totals and budget. If Splitwise changes later, you&apos;ll be asked whether to accept the changes or keep what you closed with.
      </ConfirmDialog>
    </>
  );
}

/** Closed months can be opened again. The closed snapshot is discarded and the live data takes over. */
export function ReopenMonthButton({ month, version }: { month: string; version: number }) {
  const a = useAction(reopenMonthAction, { success: () => `${monthLabel(month)} is open again` });
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <button onClick={() => setConfirming(true)} className={btnSecondary}>
        <Icon>
          <rect x="4.5" y="9" width="11" height="7.5" rx="1.5" />
          <path d="M7 9V6.8a3 3 0 0 1 5.6-1.5" />
        </Icon>
        Reopen month
      </button>
      <ConfirmDialog
        open={confirming}
        title={`Reopen ${monthLabel(month)}?`}
        confirmLabel="Reopen month"
        busy={a.pending}
        error={a.state.kind === "failed" ? <SaveStatus state={a.state} /> : null}
        onCancel={() => {
          setConfirming(false);
          a.reset();
        }}
        onConfirm={async () => {
          const r = await a.run({ month, expectedVersion: version });
          if (r?.ok) setConfirming(false);
        }}
      >
        You&apos;ll be able to edit this month again. Its frozen snapshot is discarded, so the totals will follow the live Splitwise data until you close it again. Its budget stays as it was.
      </ConfirmDialog>
    </>
  );
}

/** One status chip: a dot plus a word ("Open", "Open · Month to date", "Closed"). */
export function StatusChip({ closed, monthToDate }: { closed: boolean; monthToDate: boolean }) {
  const tone = closed ? "bg-forest-700 text-white" : monthToDate ? "bg-warn-50 text-warn" : "bg-forest-50 text-brand-strong";
  return (
    <span className={`inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium ${tone}`}>
      {closed ? (
        <Icon>
          <rect x="4.5" y="9" width="11" height="7.5" rx="1.5" />
          <path d="M7 9V6.8a3 3 0 0 1 6 0V9" />
        </Icon>
      ) : (
        <span aria-hidden="true" className={`size-1.5 rounded-full ${monthToDate ? "bg-warn" : "bg-forest-600"}`} />
      )}
      {closed ? "Closed" : monthToDate ? "Open · Month to date" : "Open"}
    </span>
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
  const accept = useAction(acceptChangesAction, { success: "Recomputed from Splitwise" });
  const keep = useAction(keepSnapshotAction, { success: "Keeping the closed snapshot" });
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
        {accept.state.kind === "failed" ? <SaveStatus state={accept.state} /> : <SaveStatus state={keep.state} />}
      </div>
    </section>
  );
}
