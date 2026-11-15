"use client";

import { useState } from "react";
import { SaveStatus } from "@/components/save-status";
import { monthLabel } from "@/engines/dates";
import { formatUSD } from "@/engines/money";
import { useAction } from "@/lib/client/use-action";
import { importHistoryAction, previewHistoryAction } from "@/server/actions/history";
import type { HistoryPreview } from "@/server/repos/history";

export function HistoryImport() {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<HistoryPreview | null>(null);
  const prev = useAction(previewHistoryAction);
  const imp = useAction(importHistoryAction);
  const mismatches = preview?.months.filter((m) => m.matches === false).length ?? 0;

  return (
    <div className="space-y-4">
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          setPreview(null);
          imp.reset();
          if (!f) return;
          const t = await f.text();
          setText(t);
          setFileName(f.name);
          const r = await prev.run({ text: t });
          if (r?.ok) setPreview(r.data);
        }}
        className="block w-full text-sm file:mr-3 file:h-11 file:rounded-xl file:border-0 file:bg-forest-50 file:px-4 file:font-medium file:text-forest-800"
      />
      <SaveStatus state={prev.state.kind === "saved" ? { kind: "idle" } : prev.state} />

      {preview && (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Preview of {fileName}: {preview.rowCount} rows across {preview.months.length} months. Nothing has been saved yet.
          </p>
          {preview.errors.length > 0 && (
            <div role="alert" className="rounded-xl border border-danger/30 bg-danger-50 p-3 text-sm text-danger">
              <p className="font-medium">{preview.errors.length} problem(s) — fix the file and choose it again:</p>
              <ul className="mt-1 list-disc pl-5">
                {preview.errors.slice(0, 20).map((e) => (
                  <li key={e.line}>
                    Line {e.line}: {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-faint">
              <tr>
                <th className="py-1 font-medium">Month</th>
                <th className="py-1 text-right font-medium">Total</th>
                <th className="py-1 text-right font-medium">Known total</th>
                <th className="py-1 font-medium">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {preview.months.map((m) => (
                <tr key={m.month} className="border-t border-line/60">
                  <td className="py-1.5">{monthLabel(m.month)}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatUSD(m.totalMinor)}</td>
                  <td className="py-1.5 text-right tabular-nums text-muted">{m.knownMinor === null ? "—" : formatUSD(m.knownMinor)}</td>
                  <td className="py-1.5 pl-3">
                    {m.matches === false && <span className="font-medium text-danger">Differs by {formatUSD(m.totalMinor - (m.knownMinor ?? 0), { signed: true })}</span>}
                    {m.matches === true && <span className="text-forest-700">Matches</span>}
                    {m.hasDetail && <span className="text-muted"> · has detailed data, summary will be ignored</span>}
                    {m.replaces && <span className="text-muted"> · replaces the earlier summary</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {mismatches > 0 && <p className="text-sm text-danger">{mismatches} month(s) don&apos;t match the known totals. Check the file before importing.</p>}
          <div className="flex items-center gap-3">
            <button
              disabled={imp.pending || preview.errors.length > 0 || preview.rowCount === 0}
              onClick={() => imp.run({ text })}
              className="h-11 rounded-xl bg-forest-700 px-5 text-sm font-medium text-white disabled:opacity-60"
            >
              Import {preview.months.length} month{preview.months.length === 1 ? "" : "s"}
            </button>
            <SaveStatus state={imp.state} />
          </div>
        </div>
      )}
    </div>
  );
}
