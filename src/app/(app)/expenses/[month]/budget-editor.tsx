"use client";

import { useMemo, useState } from "react";
import { Drawer } from "@/components/drawer";
import { SaveStatus } from "@/components/save-status";
import { budgetStatus } from "@/engines/budget";
import { monthLabel } from "@/engines/dates";
import { formatUSD, isParsableMinor, parseMinor } from "@/engines/money";
import { useAction } from "@/lib/client/use-action";
import { previousBudgetAction, saveBudgetAction } from "@/server/actions/budgets";

const toInput = (minor: number) => (minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2));

export function BudgetEditor({
  month,
  categories,
  amounts,
  actuals,
  source,
}: {
  month: string;
  categories: { id: string; name: string }[];
  /** category id → current budget (minor) */
  amounts: Record<string, number>;
  /** category name → actual spend this month (minor), absent when not recorded */
  actuals: Record<string, number> | null;
  source: "month" | "default";
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(categories.map((c) => [c.id, toInput(amounts[c.id] ?? 0)])));
  const save = useAction(saveBudgetAction, { success: "Budget saved" });
  const copy = useAction(previousBudgetAction, { success: "Copied last month's budget — review and save" });
  const parsed = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, isParsableMinor(values[c.id] || "0") ? parseMinor(values[c.id] || "0") : null])),
    [values, categories],
  );
  const invalid = categories.filter((c) => parsed[c.id] === null || (parsed[c.id] ?? 0) < 0);
  const total = categories.reduce((s, c) => s + (parsed[c.id] ?? 0), 0);
  const actualTotal = actuals ? Object.values(actuals).reduce((a, b) => a + b, 0) : null;

  async function submit(scope: "month" | "default") {
    if (invalid.length) return;
    const res = await save.run({ month, scope, amounts: categories.map((c) => ({ categoryId: c.id, amountMinor: parsed[c.id]! })), expected: amounts });
    if (res?.ok) setOpen(false);
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="h-9 rounded-lg px-3 text-sm font-medium text-forest-700 hover:bg-forest-50">
        Edit budget
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title={`Budget · ${monthLabel(month)}`}>
        <p className="mb-4 text-sm text-muted">
          {source === "month" ? "This month has its own budget." : "This month follows the default budget."} Saving as the default affects this and future months that don&apos;t have their own budget; past months keep theirs.
        </p>
        <button
          disabled={copy.pending}
          onClick={async () => {
            const r = await copy.run({ month });
            if (r?.ok) setValues(Object.fromEntries(categories.map((c) => [c.id, toInput(r.data.amounts[c.id] ?? 0)])));
          }}
          className="mb-4 h-10 rounded-lg border border-line px-3 text-sm hover:bg-forest-50"
        >
          Copy last month
        </button>
        <SaveStatus state={copy.state.kind === "saved" ? { kind: "idle" } : copy.state} />
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-faint">
            <tr>
              <th className="py-2 font-medium">Category</th>
              <th className="py-2 font-medium">Budget</th>
              <th className="py-2 text-right font-medium">Actual</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => {
              const actual = actuals ? (actuals[c.name] ?? 0) : null;
              const st = budgetStatus(actual, parsed[c.id] ?? 0);
              return (
                <tr key={c.id} className="border-t border-line/60">
                  <td className="py-2 pr-2">{c.name}</td>
                  <td className="py-2 pr-2">
                    <span className={`flex w-32 items-center rounded-lg border bg-surface px-2 ${parsed[c.id] === null ? "border-danger" : "border-line"}`}>
                      <span className="text-muted">$</span>
                      <input
                        inputMode="decimal"
                        aria-label={`${c.name} budget`}
                        value={values[c.id] ?? ""}
                        onChange={(e) => setValues((v) => ({ ...v, [c.id]: e.target.value }))}
                        className="h-10 w-full bg-transparent px-1 outline-none"
                      />
                    </span>
                  </td>
                  <td className="py-2 text-right">
                    <div className="tabular-nums">{actual === null ? "—" : formatUSD(actual)}</div>
                    <div className={`text-xs ${st.tone === "danger" ? "text-danger" : "text-muted"}`}>{st.text}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line font-semibold">
              <td className="py-2">Total</td>
              <td className="py-2 tabular-nums">{formatUSD(total)}</td>
              <td className="py-2 text-right tabular-nums">{actualTotal === null ? "Not recorded" : formatUSD(actualTotal)}</td>
            </tr>
          </tfoot>
        </table>
        {invalid.length > 0 && <p className="mt-3 text-sm text-danger">Fix: {invalid.map((c) => c.name).join(", ")} (amounts like 100 or 100.50, not negative).</p>}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button disabled={save.pending || invalid.length > 0} onClick={() => submit("month")} className="h-11 rounded-xl bg-forest-700 px-4 text-sm font-medium text-white disabled:opacity-60">
            Save for {monthLabel(month)} only
          </button>
          <button disabled={save.pending || invalid.length > 0} onClick={() => submit("default")} className="h-11 rounded-xl border border-line px-4 text-sm font-medium hover:bg-forest-50 disabled:opacity-60">
            Save as default from {monthLabel(month, "short")} on
          </button>
          <SaveStatus state={save.state} />
        </div>
      </Drawer>
    </>
  );
}
