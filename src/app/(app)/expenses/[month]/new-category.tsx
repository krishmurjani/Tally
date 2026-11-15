"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SaveStatus } from "@/components/save-status";
import { monthLabel } from "@/engines/dates";
import { useAction } from "@/lib/client/use-action";
import { createCategoryWithBudgetAction } from "@/server/actions/budgets";

type Open = (onCreated?: (categoryId: string) => void) => void;
const Ctx = createContext<Open | null>(null);

/** Returns a function that opens the "New category" dialog, or null when it isn't available (closed month). */
export function useNewCategory(): Open | null {
  return useContext(Ctx);
}

const field = "h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink outline-none transition focus:border-forest-600";

export function NewCategoryProvider({ month, closed, children }: { month: string; closed: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("");
  const [scope, setScope] = useState<"month" | "default">("default");
  const [after, setAfter] = useState<((id: string) => void) | undefined>();
  const a = useAction(createCategoryWithBudgetAction, { success: (c) => `Category “${c.name}” created` });
  const start = useCallback<Open>((onCreated) => {
    setName("");
    setBudget("");
    setScope("default");
    setAfter(() => onCreated);
    setOpen(true);
  }, []);
  const label = monthLabel(month);
  return (
    <Ctx.Provider value={closed ? null : start}>
      {children}
      <ConfirmDialog
        open={open}
        title="New category"
        confirmLabel="Create category"
        busy={a.pending}
        error={a.state.kind === "failed" ? <SaveStatus state={a.state} /> : null}
        onCancel={() => {
          setOpen(false);
          a.reset();
        }}
        onConfirm={async () => {
          if (!name.trim()) return;
          const r = await a.run({ name, budget, scope, month });
          if (r?.ok) {
            setOpen(false);
            after?.(r.data.id);
          }
        }}
      >
        <div className="space-y-4 text-left">
          <label className="block space-y-1 text-sm">
            <span className="text-muted">Name</span>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. Trip - Miami" className={field} />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-muted">Monthly budget (USD, optional)</span>
            <input inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="0" className={field} />
          </label>
          <fieldset className="space-y-2 text-sm">
            <legend className="mb-1 text-muted">Add it…</legend>
            {(
              [
                ["default", `As a default from ${label} on`, "Every month from then on gets this budget. Earlier months are untouched."],
                ["month", `For ${label} only`, "Only this month gets the budget. Other months show it with no budget."],
              ] as const
            ).map(([value, title, hint]) => (
              <label key={value} className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition ${scope === value ? "border-forest-600 bg-forest-50" : "border-line hover:bg-forest-50/50"}`}>
                <input type="radio" name="new-cat-scope" value={value} checked={scope === value} onChange={() => setScope(value)} className="mt-1 accent-forest-700" />
                <span>
                  <span className="block font-medium text-ink">{title}</span>
                  <span className="block text-xs text-muted">{hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
        </div>
      </ConfirmDialog>
    </Ctx.Provider>
  );
}
