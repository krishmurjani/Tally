"use client";

import { useState } from "react";
import { formatUSD, isParsableMinor, parseMinor } from "@/engines/money";
import { SaveStatus, type SaveState } from "@/components/save-status";
import { withRetry } from "@/lib/client/retry";
import { saveLargeThreshold } from "@/server/actions/settings";

export function ThresholdForm({ initialMinor, initialVersion }: { initialMinor: number; initialVersion: number }) {
  const [value, setValue] = useState((initialMinor / 100).toFixed(2));
  const [version, setVersion] = useState(initialVersion);
  const [saved, setSaved] = useState(initialMinor);
  const [state, setState] = useState<SaveState>({ kind: "idle" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!isParsableMinor(value) || parseMinor(value) < 0) {
      setState({ kind: "failed", message: "enter an amount like 100 or 100.00" });
      return;
    }
    setState({ kind: "saving" });
    try {
      const res = await withRetry(() => saveLargeThreshold({ thresholdMinor: parseMinor(value), expectedVersion: version }));
      if (res.ok) {
        setVersion(res.data.version);
        setSaved(res.data.largeExpenseThresholdMinor);
        setState({ kind: "saved" });
      } else {
        setState({ kind: "failed", message: res.error === "conflict" ? "changed elsewhere — reload the page" : res.message });
      }
    } catch {
      setState({ kind: "failed", message: "couldn't reach the server" });
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">Flag expenses where my share is at least</span>
        <span className="flex items-center rounded-xl border border-line bg-surface px-3 focus-within:border-forest-600">
          <span className="text-muted">$</span>
          <input
            inputMode="decimal"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setState({ kind: "idle" });
            }}
            className="h-11 w-28 bg-transparent px-2 outline-none"
            aria-label="Large expense threshold in dollars"
          />
        </span>
      </label>
      <button type="submit" disabled={state.kind === "saving"} className="h-11 rounded-xl bg-forest-700 px-4 text-sm font-medium text-white hover:bg-forest-800 disabled:opacity-60">
        Save
      </button>
      <SaveStatus state={state} />
      <p className="w-full text-xs text-faint">Current: {formatUSD(saved)}. Recurring rent and phone are never flagged.</p>
    </form>
  );
}
