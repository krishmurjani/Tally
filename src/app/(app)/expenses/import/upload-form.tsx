"use client";

import { useState } from "react";
import { SaveStatus, type SaveState } from "@/components/save-status";
import { useToast } from "@/components/toast";
import { importCsvAction } from "@/server/actions/expenses";
import type { ImportResult } from "@/server/repos/csv-import";

export function UploadForm() {
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const toast = useToast();
  const [results, setResults] = useState<ImportResult[]>([]);
  return (
    <form
      action={async (fd) => {
        setState({ kind: "saving" });
        try {
          const res = await importCsvAction(fd);
          if (res.ok) {
            setResults(res.data);
            const failed = res.data.filter((r) => r.status === "error").length;
            const done = res.data.filter((r) => r.status === "imported").length;
            setState(failed ? { kind: "failed", message: `${failed} file(s) weren't imported — see below` } : { kind: "saved" });
            if (done) toast({ text: `Imported ${done} file${done === 1 ? "" : "s"}` });
          } else setState({ kind: "failed", message: res.message });
        } catch {
          setState({ kind: "failed", message: "couldn't reach the server. Nothing was imported." });
        }
      }}
      className="space-y-4"
    >
      <input
        type="file"
        name="files"
        multiple
        accept=".csv,text/csv"
        required
        className="block w-full text-sm file:mr-3 file:h-11 file:rounded-xl file:border-0 file:bg-forest-50 file:px-4 file:font-medium file:text-forest-800"
      />
      <div className="flex items-center gap-3">
        <button type="submit" disabled={state.kind === "saving"} className="h-11 rounded-xl bg-forest-700 px-5 text-sm font-medium text-white disabled:opacity-60">
          Import
        </button>
        <SaveStatus state={state} />
      </div>
      {results.length > 0 && (
        <ul className="space-y-1 text-sm">
          {results.map((r, i) => (
            <li key={i} className={r.status === "error" ? "text-danger" : ""}>
              <b>{r.fileName}</b> —{" "}
              {r.status === "imported"
                ? `imported (${r.kind}, ${r.rows} rows${r.unreadableRows ? `, ${r.unreadableRows} unreadable → shown for review` : ""})`
                : r.status === "duplicate"
                  ? "already imported"
                  : r.message}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
