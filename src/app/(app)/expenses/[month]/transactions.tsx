"use client";

import { useMemo, useState } from "react";
import { Drawer } from "@/components/drawer";
import { Usd } from "@/components/money";
import { SaveStatus } from "@/components/save-status";
import { Badge } from "@/components/ui";
import { formatUSD } from "@/engines/money";
import { newIdempotencyKey, useAction } from "@/lib/client/use-action";
import {
  confirmUsdAction,
  mapSplitwiseCategoryAction,
  markNotExpenseAction,
  resetCategoryAction,
  setCategoryAction,
  undoDecisionAction,
} from "@/server/actions/expenses";
import type { DisplayRow } from "@/server/month-data";
import { ExpenseForm } from "./expense-form";

type Cat = { id: string; name: string };
const NEEDS = "__needs__";

export function statusLabel(r: DisplayRow): { tone: "neutral" | "forest" | "warn" | "danger"; text: string } {
  if (r.status === "review") return { tone: "warn", text: "Needs review" };
  if (r.status === "excluded") return { tone: "neutral", text: "Excluded" };
  if (r.flags.includes("needs_category")) return { tone: "warn", text: "Needs category" };
  return { tone: "forest", text: "Included" };
}

function Flags({ r }: { r: DisplayRow }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {r.flags.includes("large") && <Badge tone="warn">Large</Badge>}
      {r.flags.includes("auto_categorized") && <Badge>auto-categorized</Badge>}
      {r.source === "manual" && <Badge>manual</Badge>}
      {r.source === "recurring" && <Badge>recurring</Badge>}
    </span>
  );
}

export function Transactions({ rows, categories, month, closed }: { rows: DisplayRow[]; categories: Cat[]; month: string; closed: boolean }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [group, setGroup] = useState("");
  const [status, setStatus] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const groups = useMemo(() => [...new Set(rows.map((r) => r.group).filter(Boolean))].sort() as string[], [rows]);
  const filtered = rows.filter((r) => {
    if (q && !`${r.description} ${r.group ?? ""} ${r.sourceCategory ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (cat === NEEDS ? r.category !== null || r.status !== "included" : cat && r.category !== cat) return false;
    if (group && r.group !== group) return false;
    if (status && r.status !== status) return false;
    return true;
  });
  const open = rows.find((r) => r.key === openKey) ?? null;
  const sel = "h-11 rounded-xl border border-line bg-surface px-3 text-sm";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search transactions" className={`${sel} min-w-0 flex-1 sm:max-w-64`} />
        <select aria-label="Filter by category" value={cat} onChange={(e) => setCat(e.target.value)} className={sel}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.name}>
              {c.name}
            </option>
          ))}
          <option value={NEEDS}>Needs category</option>
        </select>
        <select aria-label="Filter by group" value={group} onChange={(e) => setGroup(e.target.value)} className={sel}>
          <option value="">All groups</option>
          {groups.map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
        <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className={sel}>
          <option value="">Included, excluded & review</option>
          <option value="included">Included</option>
          <option value="excluded">Excluded</option>
          <option value="review">Needs review</option>
        </select>
      </div>
      <p className="text-sm text-muted">
        {filtered.length} of {rows.length} rows · my share of shown included rows{" "}
        <Usd minor={filtered.filter((r) => r.status === "included").reduce((s, r) => s + r.shareMinor, 0)} />
      </p>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-faint">
            <tr className="border-b border-line">
              <th className="py-2 pr-3 font-medium">Date</th>
              <th className="py-2 pr-3 font-medium">Description</th>
              <th className="py-2 pr-3 font-medium">Category</th>
              <th className="py-2 pr-3 text-right font-medium">My share</th>
              <th className="py-2 pr-3 text-right font-medium">Full cost</th>
              <th className="py-2 pr-3 font-medium">Group</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 font-medium">
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const s = statusLabel(r);
              return (
                <tr key={r.key} className={`border-b border-line/60 align-top ${r.status === "excluded" ? "text-muted" : ""}`}>
                  <td className="whitespace-nowrap py-2.5 pr-3 tabular-nums">{r.date.slice(5)}</td>
                  <td className="py-2.5 pr-3">
                    <div>{r.description}</div>
                    <Flags r={r} />
                  </td>
                  <td className="py-2.5 pr-3">{r.category ?? <span className="text-warn">Needs category</span>}</td>
                  <td className={`py-2.5 pr-3 text-right font-medium ${r.status === "included" ? "" : "line-through decoration-faint"}`}>
                    <Usd minor={r.status === "included" ? r.shareMinor : 0} />
                  </td>
                  <td className="py-2.5 pr-3 text-right text-faint">
                    {r.currency === "USD" ? <Usd minor={r.costMinor} /> : `${(r.costMinor / 100).toFixed(2)} ${r.currency}`}
                  </td>
                  <td className="max-w-40 truncate py-2.5 pr-3 text-muted" title={r.group ?? ""}>
                    {r.group ?? "—"}
                  </td>
                  <td className="py-2.5 pr-3">
                    <Badge tone={s.tone}>{s.text}</Badge>
                    {r.status !== "included" && <div className="mt-1 text-xs text-muted">{r.reasonText}</div>}
                  </td>
                  <td className="py-2.5">
                    <button onClick={() => setOpenKey(r.key)} className="h-9 rounded-lg px-3 text-forest-700 hover:bg-forest-50">
                      {closed ? "View" : "Edit"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <ul className="space-y-2 md:hidden">
        {filtered.map((r) => {
          const s = statusLabel(r);
          return (
            <li key={r.key}>
              <button onClick={() => setOpenKey(r.key)} className="w-full rounded-xl border border-line bg-surface p-3 text-left active:bg-forest-50">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className={`truncate font-medium ${r.status === "excluded" ? "text-muted" : ""}`}>{r.description}</p>
                    <p className="text-xs text-muted">
                      {r.date.slice(5)} · {r.category ?? "Needs category"} · {r.group ?? "—"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`font-semibold ${r.status === "included" ? "" : "text-muted line-through"}`}>
                      <Usd minor={r.status === "included" ? r.shareMinor : 0} />
                    </p>
                    <p className="text-xs text-faint">of {r.currency === "USD" ? formatUSD(r.costMinor) : `${(r.costMinor / 100).toFixed(2)} ${r.currency}`}</p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <Badge tone={s.tone}>{s.text}</Badge>
                  <Flags r={r} />
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      {filtered.length === 0 && <p className="py-6 text-center text-sm text-muted">No rows match these filters.</p>}

      <Drawer open={!!open} onClose={() => setOpenKey(null)} title={open?.description ?? ""}>
        {open && <RowDetail key={open.key} row={open} categories={categories} month={month} closed={closed} onClose={() => setOpenKey(null)} />}
      </Drawer>
    </div>
  );
}

export function RowDetail({ row, categories, month, closed, onClose }: { row: DisplayRow; categories: Cat[]; month: string; closed: boolean; onClose: () => void }) {
  const setCat = useAction(setCategoryAction);
  const resetCat = useAction(resetCategoryAction);
  const mapCat = useAction(mapSplitwiseCategoryAction);
  const markNot = useAction(markNotExpenseAction);
  const undo = useAction(undoDecisionAction);
  const usd = useAction(confirmUsdAction);
  const [idem] = useState(newIdempotencyKey);
  const [reason, setReason] = useState("");
  const [usdAmount, setUsdAmount] = useState("");
  const [editingManual, setEditingManual] = useState(false);
  const currentCatId = categories.find((c) => c.name === row.category)?.id ?? "";
  const s = statusLabel(row);
  const canDecide = !closed && row.source !== "recurring" && row.source !== "manual";

  if (editingManual && row.manual) {
    return (
      <ExpenseForm
        month={month}
        categories={categories}
        editing={{ id: row.manual.id, version: row.manual.version, date: row.date, description: row.description, categoryId: row.manual.categoryId, amountMinor: row.manual.amountMinor, note: row.manual.note }}
        onDone={onClose}
      />
    );
  }

  return (
    <div className="space-y-6 text-sm">
      <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2">
        <dt className="text-muted">My share</dt>
        <dd className="font-semibold">
          <Usd minor={row.status === "included" ? row.shareMinor : 0} /> <Badge tone={s.tone}>{s.text}</Badge>
        </dd>
        <dt className="text-muted">Full cost</dt>
        <dd>{row.currency === "USD" ? formatUSD(row.costMinor) : `${(row.costMinor / 100).toFixed(2)} ${row.currency}`}</dd>
        <dt className="text-muted">Date</dt>
        <dd>{row.date}</dd>
        <dt className="text-muted">Group</dt>
        <dd>{row.group ?? "—"}</dd>
        <dt className="text-muted">Splitwise category</dt>
        <dd>{row.sourceCategory ?? "—"}</dd>
        <dt className="text-muted">Status</dt>
        <dd>{row.reasonText}</dd>
      </dl>

      <section>
        <h3 className="mb-2 font-semibold">How my share was worked out</h3>
        <ol className="list-decimal space-y-1 pl-5 text-muted">
          {row.derivation.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ol>
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">Category</h3>
        <p className="text-muted">{row.categoryExplanation}</p>
        {!closed && row.source !== "recurring" && (
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Category"
              value={currentCatId}
              disabled={setCat.pending}
              onChange={(e) => e.target.value && setCat.run({ rowKey: row.key, categoryId: e.target.value })}
              className="h-11 rounded-xl border border-line bg-surface px-3"
            >
              {!currentCatId && <option value="">Choose a category…</option>}
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {row.hasOverride && (
              <button onClick={() => resetCat.run({ rowKey: row.key })} className="h-11 px-2 text-forest-700 hover:underline">
                Reset to automatic
              </button>
            )}
            <SaveStatus state={setCat.state.kind !== "idle" ? setCat.state : resetCat.state} />
          </div>
        )}
        {!closed && row.sourceCategory && (row.suggestion || currentCatId) && (
          <div className="flex flex-wrap items-center gap-2">
            {row.suggestion && (
              <button
                onClick={() => {
                  const id = categories.find((c) => c.name === row.suggestion)?.id;
                  if (id) mapCat.run({ splitwiseName: row.sourceCategory!, categoryId: id });
                }}
                className="h-11 rounded-xl border border-forest-100 bg-forest-50 px-3 text-forest-800"
              >
                Confirm: always map “{row.sourceCategory}” → {row.suggestion}
              </button>
            )}
            {!row.suggestion && currentCatId && row.categorySource !== "mapping" && (
              <button onClick={() => mapCat.run({ splitwiseName: row.sourceCategory!, categoryId: currentCatId })} className="h-11 px-2 text-forest-700 hover:underline">
                Always map “{row.sourceCategory}” → {row.category}
              </button>
            )}
            <SaveStatus state={mapCat.state} />
          </div>
        )}
      </section>

      {!closed && row.reason === "non_usd" && row.splitwiseId && (
        <section className="space-y-2">
          <h3 className="font-semibold">Confirm the USD amount</h3>
          <p className="text-muted">Not counted until you enter what my share cost in USD.</p>
          <div className="flex flex-wrap gap-2">
            <input inputMode="decimal" value={usdAmount} onChange={(e) => setUsdAmount(e.target.value)} placeholder="USD" className="h-11 w-32 rounded-xl border border-line px-3" />
            <button disabled={usd.pending} onClick={() => usd.run({ splitwiseId: row.splitwiseId!, usdAmount, note: null })} className="h-11 rounded-xl bg-forest-700 px-4 text-white">
              Confirm
            </button>
            <SaveStatus state={usd.state} />
          </div>
        </section>
      )}

      {canDecide && (
        <section className="space-y-2">
          <h3 className="font-semibold">Not an expense?</h3>
          {row.decision ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted">Marked “{row.decision.reason || "Not an expense"}”.</span>
              <button disabled={undo.pending} onClick={() => undo.run({ id: row.decision!.id, expectedVersion: row.decision!.version })} className="h-11 rounded-xl border border-line px-4">
                Undo
              </button>
              <SaveStatus state={undo.state} />
            </div>
          ) : row.status !== "excluded" ? (
            <div className="flex flex-wrap items-center gap-2">
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" maxLength={300} className="h-11 min-w-0 flex-1 rounded-xl border border-line px-3" />
              <button
                disabled={markNot.pending}
                onClick={() => markNot.run({ rowKey: row.key, reason: reason.trim() || null, idempotencyKey: idem })}
                className="h-11 rounded-xl border border-line bg-surface px-4 font-medium hover:bg-forest-50"
              >
                Not an expense
              </button>
              <SaveStatus state={markNot.state} />
              <p className="w-full text-xs text-faint">Only this expense — no rule is created for similar ones.</p>
            </div>
          ) : (
            <p className="text-muted">Already excluded by a rule ({row.reasonText}).</p>
          )}
        </section>
      )}

      {!closed && row.manual && (
        <button onClick={() => setEditingManual(true)} className="h-11 rounded-xl border border-line px-4 font-medium">
          Edit or delete this expense
        </button>
      )}
      {closed && <p className="text-xs text-faint">This month is closed — rows are shown as they were frozen.</p>}
    </div>
  );
}
