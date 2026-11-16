"use client";

import { useRef, useState } from "react";
import { SaveStatus } from "@/components/save-status";
import { useAction } from "@/lib/client/use-action";
import { previewRestoreAction, restoreBackupAction } from "@/server/actions/backup";
import type { RestorePreview } from "@/server/backup";

export function RestoreForm() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [confirm, setConfirm] = useState("");
  const prev = useAction(previewRestoreAction, { success: false });
  const restore = useAction(restoreBackupAction, { success: "Backup restored" });
  const fd = (extra: Record<string, string> = {}) => {
    const f = new FormData();
    const file = fileRef.current?.files?.[0];
    if (file) f.set("file", file);
    for (const [k, v] of Object.entries(extra)) f.set(k, v);
    return f;
  };

  return (
    <div className="space-y-4">
      <input
        ref={fileRef}
        type="file"
        accept=".gz,.json,application/gzip,application/json"
        onChange={async () => {
          setPreview(null);
          restore.reset();
          const r = await prev.run(fd());
          if (r?.ok) setPreview(r.data);
        }}
        className="block w-full text-sm file:mr-3 file:h-11 file:rounded-xl file:border-0 file:bg-forest-50 file:px-4 file:font-medium file:text-brand-strong"
      />
      <SaveStatus state={prev.state.kind === "saved" ? { kind: "idle" } : prev.state} />
      {preview && (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Dry run of a backup from {new Date(preview.exportedAt).toLocaleString("en-US", { timeZone: "America/New_York" })}. Nothing has changed yet.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-faint">
                <tr>
                  <th className="py-1 font-medium">Table</th>
                  <th className="hidden py-1 text-right font-medium sm:table-cell">Backup</th>
                  <th className="hidden py-1 text-right font-medium sm:table-cell">Now</th>
                  <th className="py-1 text-right font-medium">New</th>
                  <th className="hidden py-1 text-right font-medium sm:table-cell">Same</th>
                  <th className="py-1 text-right font-medium">Different</th>
                  <th className="py-1 text-right font-medium">Only now</th>
                </tr>
              </thead>
              <tbody>
                {preview.tables
                  .filter((t) => t.inBackup || t.inDatabase)
                  .map((t) => (
                    <tr key={t.table} className="border-t border-line/60 tabular-nums">
                      <td className="py-1">{t.table}</td>
                      <td className="hidden py-1 text-right sm:table-cell">{t.inBackup}</td>
                      <td className="hidden py-1 text-right sm:table-cell">{t.inDatabase}</td>
                      <td className="py-1 text-right">{t.newRows || ""}</td>
                      <td className="hidden py-1 text-right text-muted sm:table-cell">{t.identical || ""}</td>
                      <td className={`py-1 text-right ${t.different ? "font-medium text-warn" : ""}`}>{t.different || ""}</td>
                      <td className={`py-1 text-right ${t.onlyInDatabase ? "font-medium text-warn" : ""}`}>{t.onlyInDatabase || ""}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-line p-4">
              <h3 className="font-semibold">Add missing rows</h3>
              <p className="mt-1 text-sm text-muted">
                Adds the {preview.totals.newRows} rows that aren&apos;t here. Leaves the {preview.totals.different} rows that differ exactly as they are now.
              </p>
              <button disabled={restore.pending || preview.totals.newRows === 0} onClick={() => restore.run(fd({ mode: "merge" }))} className="mt-3 h-11 rounded-xl bg-forest-700 px-4 text-sm font-medium text-white disabled:opacity-60">
                Add {preview.totals.newRows} rows
              </button>
            </div>
            <div className="rounded-xl border border-danger/30 p-4">
              <h3 className="font-semibold text-danger">Replace everything</h3>
              <p className="mt-1 text-sm text-muted">
                Deletes all current data ({preview.totals.onlyInDatabase} rows exist only here and would be lost) and loads the backup. Type REPLACE to confirm.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="REPLACE" aria-label="Type REPLACE to confirm" className="h-11 w-32 rounded-xl border border-line px-3" />
                <button disabled={restore.pending || confirm !== "REPLACE"} onClick={() => restore.run(fd({ mode: "replace", confirm }))} className="h-11 rounded-xl border border-danger/40 px-4 text-sm font-medium text-danger disabled:opacity-60">
                  Replace with backup
                </button>
              </div>
            </div>
          </div>
          <SaveStatus state={restore.state} />
        </div>
      )}
    </div>
  );
}
