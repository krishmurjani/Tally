"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SaveStatus, type SaveState } from "@/components/save-status";
import { Select } from "@/components/select";
import { Badge, Card, Stat } from "@/components/ui";
import { monthLabel } from "@/engines/dates";
import { planPayoff, requiredMonthlyContribution, usdToInr, effectiveFx, type PlannerBase, type PlannerWarning } from "@/engines/loan/planner";
import { linkDrift, plannerInputs, type Scenario } from "@/engines/loan/scenario";
import { formatINR, formatUSD, isParsableMinor, parseMinor } from "@/engines/money";
import { isDecimalString } from "@/engines/rational";
import { saveScenarioAction } from "@/server/actions/loan";
import { BalanceChart } from "./balance-chart";

export interface LinkOption {
  month: string;
  incomeMinor: number | null;
  expensesMinor: number | null;
  partial: boolean;
}

const usd = (m: number) => formatUSD(m, { decimals: "auto" });
const inr = (m: number) => formatINR(m, { decimals: "never" });

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-1 text-sm">
      <span className="block font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </div>
  );
}

/** Slider + exact number input, in dollars. */
function MoneySlider({ label, valueMinor, onChange, max, step = 50, hint, disabled }: { label: string; valueMinor: number; onChange: (m: number) => void; max: number; step?: number; hint?: ReactNode; disabled?: boolean }) {
  const [text, setText] = useState(String(valueMinor / 100));
  const [focused, setFocused] = useState(false);
  const shown = focused ? text : String(valueMinor / 100);
  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={Math.max(max, valueMinor / 100)}
          step={step}
          value={valueMinor / 100}
          disabled={disabled}
          onChange={(e) => onChange(Math.round(Number(e.target.value) * 100))}
          aria-label={`${label} slider`}
          className="h-11 flex-1 accent-forest-700"
        />
        <span className={`flex w-32 items-center rounded-lg border bg-surface px-2 ${isParsableMinor(shown) || shown === "" ? "border-line" : "border-danger"}`}>
          <span className="text-muted">$</span>
          <input
            inputMode="decimal"
            value={shown}
            disabled={disabled}
            aria-label={label}
            onFocus={() => {
              setText(String(valueMinor / 100));
              setFocused(true);
            }}
            onBlur={() => setFocused(false)}
            onChange={(e) => {
              setText(e.target.value);
              const v = e.target.value.trim() || "0";
              if (isParsableMinor(v) && parseMinor(v) >= 0) onChange(parseMinor(v));
            }}
            className="h-10 w-full bg-transparent px-1 outline-none"
          />
        </span>
      </div>
    </Field>
  );
}

function DecimalSlider({ label, value, onChange, max, step, suffix, hint }: { label: string; value: string; onChange: (v: string) => void; max: number; step: number; suffix: string; hint?: ReactNode }) {
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  const shown = focused ? text : value;
  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-3">
        <input type="range" min={0} max={max} step={step} value={Number(value)} onChange={(e) => onChange(e.target.value)} aria-label={`${label} slider`} className="h-11 flex-1 accent-forest-700" />
        <span className={`flex w-28 items-center rounded-lg border bg-surface px-2 ${isDecimalString(shown) ? "border-line" : "border-danger"}`}>
          <input
            inputMode="decimal"
            value={shown}
            aria-label={label}
            onFocus={() => {
              setText(value);
              setFocused(true);
            }}
            onBlur={() => setFocused(false)}
            onChange={(e) => {
              setText(e.target.value);
              if (isDecimalString(e.target.value) && Number(e.target.value) <= max * 10) onChange(e.target.value.trim());
            }}
            className="h-10 w-full bg-transparent px-1 outline-none"
          />
          <span className="text-muted">{suffix}</span>
        </span>
      </div>
    </Field>
  );
}

function warningText(w: PlannerWarning): string {
  switch (w.code) {
    case "deficit":
      return `${w.message} Short by ${usd(w.deficitUsdMinor)}/month.`;
    case "unaffordable":
      return `${w.message} Needs ${usd(w.neededUsdMinor)}/month; ${usd(w.availableUsdMinor)} available.`;
    case "lump_exceeds_available":
      return `${w.message} Using ${usd(w.allowedUsdMinor)} instead of ${usd(w.requestedUsdMinor)}.`;
    default:
      return w.message;
  }
}

export function Planner({
  base,
  initial,
  months,
  scheduleFinalMonth,
  rateNote,
}: {
  base: PlannerBase;
  initial: { inputs: Scenario; version: number | null };
  months: LinkOption[];
  scheduleFinalMonth: string | null;
  rateNote: string;
}) {
  const [s, setS] = useState<Scenario>(initial.inputs);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const version = useRef<number | null>(initial.version);
  const first = useRef(true);
  const inflight = useRef(false);
  const pending = useRef<Scenario | null>(null);
  const deferred = useDeferredValue(s);
  const set = <K extends keyof Scenario>(k: K, v: Scenario[K]) => setS((p) => ({ ...p, [k]: v }));

  // Debounced autosave: no DB write per slider tick; "Saved" only after the server confirms.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setSave({ kind: "saving" });
    const t = setTimeout(() => {
      pending.current = s;
      void flush();
    }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s]);

  async function flush() {
    if (inflight.current || !pending.current) return;
    inflight.current = true;
    const inputs = pending.current;
    pending.current = null;
    try {
      const r = await saveScenarioAction({ inputs, expectedVersion: version.current });
      if (r.ok) {
        version.current = r.data.version;
        setSave(pending.current ? { kind: "saving" } : { kind: "saved" });
      } else {
        setSave({ kind: "failed", message: r.error === "conflict" ? "the plan was changed in another tab — reload to continue" : r.message });
      }
    } catch {
      setSave({ kind: "failed", message: "couldn't reach the server; your latest changes aren't saved" });
    } finally {
      inflight.current = false;
      if (pending.current) void flush();
    }
  }

  const inputs = useMemo(() => plannerInputs(deferred), [deferred]);
  const result = useMemo(() => planPayoff(base, inputs), [base, inputs]);
  const required = useMemo(() => (deferred.targetDate ? requiredMonthlyContribution(base, { ...inputs, saveFirstMonths: 0 }, deferred.targetDate) : null), [base, inputs, deferred.targetDate]);
  const fx = effectiveFx(inputs.fxInrPerUsd, inputs.transferFeePercent);
  const future = (ps: typeof result.plan.periods) => ps.filter((p) => p.date >= inputs.startDate).reduce((a, p) => a + p.interestMinor, 0);
  const planInterest = future(result.plan.periods);
  const baseInterest = future(result.baseline.periods);
  const maxLump = Math.max(0, s.existingSavingsUsdMinor - s.emergencyReserveUsdMinor);
  const linkedNow = s.linked ? months.find((m) => m.month === s.linked!.month) : null;
  const drift = s.linked && linkedNow ? linkDrift(s.linked, linkedNow) : null;
  const modelFinal = result.baseline.payoffDate?.slice(0, 7) ?? null;
  const futurePeriods = result.plan.periods.filter((p) => p.date >= inputs.startDate);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_1fr]">
      <div className="space-y-6">
        <Card title="Monthly money (USD)" action={<SaveStatus state={save} showSaved />}>
          <div className="space-y-4">
            <Field label="Income & living expenses from" hint={s.linked ? "Copied from that month when you linked it — later edits there don't change the plan." : "Typed in by hand."}>
              <Select
                ariaLabel="Income and living expenses source"
                value={s.linked?.month ?? ""}
                onChange={(v) => {
                  const m = months.find((x) => x.month === v);
                  set("linked", m ? { month: m.month, incomeMinor: m.incomeMinor, expensesMinor: m.expensesMinor } : null);
                }}
                options={[
                  { value: "", label: "Manual values" },
                  ...months.map((m) => ({
                    value: m.month,
                    label: `${monthLabel(m.month)} · income ${m.incomeMinor === null ? "not recorded" : usd(m.incomeMinor)} · spent ${m.expensesMinor === null ? "not recorded" : usd(m.expensesMinor)}${m.partial ? " (partial)" : ""}`,
                  })),
                ]}
                menuMinWidth={340}
              />
            </Field>
            {s.linked && <Badge tone="forest">Linked to {monthLabel(s.linked.month)}</Badge>}
            {drift?.changed && (
              <div role="alert" className="rounded-xl border border-warn/30 bg-warn-50 p-3 text-sm text-warn">
                {monthLabel(s.linked!.month)} changed since you linked it: income {drift.income.linked === null ? "—" : usd(drift.income.linked)} → {drift.income.now === null ? "—" : usd(drift.income.now)}, spent{" "}
                {drift.expenses.linked === null ? "—" : usd(drift.expenses.linked)} → {drift.expenses.now === null ? "—" : usd(drift.expenses.now)}.{" "}
                <button onClick={() => set("linked", { month: linkedNow!.month, incomeMinor: linkedNow!.incomeMinor, expensesMinor: linkedNow!.expensesMinor })} className="font-medium underline">
                  Update the plan
                </button>
              </div>
            )}
            {s.linked && (s.linked.incomeMinor === null || s.linked.expensesMinor === null) && (
              <p className="text-sm text-warn">That month is missing {s.linked.incomeMinor === null ? "income" : "spending"} — it&apos;s treated as $0 in the plan.</p>
            )}
            <MoneySlider label="Take-home income" valueMinor={inputs.monthlyIncomeUsdMinor} onChange={(m) => set("monthlyIncomeUsdMinor", m)} max={15000} disabled={!!s.linked} />
            <MoneySlider label="Living expenses (excluding the loan)" valueMinor={inputs.monthlyExpensesUsdMinor} onChange={(m) => set("monthlyExpensesUsdMinor", m)} max={10000} disabled={!!s.linked} />
            <MoneySlider label="New savings each month" valueMinor={s.monthlyNewSavingsUsdMinor} onChange={(m) => set("monthlyNewSavingsUsdMinor", m)} max={5000} />
            <p className="rounded-xl bg-canvas px-3 py-2 text-sm">
              Available for the loan: <b>{usd(result.availableForLoanUsdMinor)}</b>/month
              {result.deficitUsdMinor > 0 && <span className="text-danger"> · deficit {usd(result.deficitUsdMinor)}/month</span>}
              <span className="block text-xs text-muted">
                {s.contributionMode === "all_available"
                  ? "All of it goes to the loan (see Strategy)."
                  : `Not all used — the plan pays the schedule plus a fixed ${usd(s.monthlyExtraUsdMinor)} extra (see Strategy).`}
              </span>
            </p>
          </div>
        </Card>

        <Card title="Savings (USD)">
          <div className="space-y-4">
            <MoneySlider label="Existing savings" valueMinor={s.existingSavingsUsdMinor} onChange={(m) => set("existingSavingsUsdMinor", m)} max={100000} step={500} />
            <MoneySlider label="Emergency reserve (never touched)" valueMinor={s.emergencyReserveUsdMinor} onChange={(m) => set("emergencyReserveUsdMinor", m)} max={50000} step={500} />
            <MoneySlider label="Lump sum to the loan" valueMinor={s.lumpSumUsdMinor} onChange={(m) => set("lumpSumUsdMinor", Math.min(m, maxLump))} max={maxLump / 100} step={500} hint={`At most ${usd(maxLump)} (existing savings − reserve).`} />
          </div>
        </Card>

        <Card title="Loan & conversion">
          <div className="space-y-4">
            <DecimalSlider label="Interest rate (annual)" value={s.annualRatePercent} onChange={(v) => set("annualRatePercent", v)} max={20} step={0.05} suffix="%" hint={rateNote} />
            <DecimalSlider label="₹ per $" value={s.fxInrPerUsd} onChange={(v) => set("fxInrPerUsd", v)} max={120} step={0.5} suffix="₹" />
            <DecimalSlider label="Transfer fee" value={s.transferFeePercent} onChange={(v) => set("transferFeePercent", v)} max={5} step={0.1} suffix="%" hint={`Effective: ₹${result.effectiveInrPerUsd} per $1 after fees.`} />
          </div>
        </Card>

        <Card title="Strategy">
          <div className="space-y-4">
            <fieldset className="space-y-2 text-sm">
              <legend className="mb-1 font-medium">Each month, pay</legend>
              {(
                [
                  ["all_available", "Everything available", "The scheduled payment comes out of it and the rest goes to the loan as extra — the extra shrinks automatically when the EMI starts."],
                  ["extra", "The schedule plus a fixed extra", "Choose an extra amount; the rest of what's available stays with you."],
                ] as const
              ).map(([value, title, hint]) => (
                <label key={value} className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${s.contributionMode === value ? "border-forest-600 bg-forest-50" : "border-line"}`}>
                  <input type="radio" name="contributionMode" value={value} checked={s.contributionMode === value} onChange={() => set("contributionMode", value)} className="mt-1 accent-forest-700" />
                  <span>
                    <span className="block font-medium">{title}</span>
                    <span className="block text-xs text-muted">{hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            {s.contributionMode === "extra" ? (
              <MoneySlider
                label="Extra each month (on top of the scheduled payment)"
                valueMinor={s.monthlyExtraUsdMinor}
                onChange={(m) => set("monthlyExtraUsdMinor", m)}
                max={Math.max(3000, result.availableForLoanUsdMinor / 100)}
                hint={`= ${inr(usdToInr(s.monthlyExtraUsdMinor, fx))}/month to the lender.`}
              />
            ) : (
              <p className="rounded-xl bg-canvas px-3 py-2 text-sm">
                First month from the start date: scheduled payment + <b>{usd(result.monthlyExtraUsdMinor)}</b> extra ({inr(result.monthlyExtraInrMinor)}).
              </p>
            )}
            <Field label="Start date">
              <input type="date" value={s.startDate} onChange={(e) => e.target.value && set("startDate", e.target.value)} className="h-11 rounded-xl border border-line bg-surface px-3" />
            </Field>
            <Field label="Save first, then repay" hint="Keep extras (and the lump sum) in a high-yield savings account for N months, then convert and pay it in one go. Scheduled payments continue meanwhile. 0 = pay straight away.">
              <div className="flex items-center gap-3">
                <input type="range" min={0} max={36} value={s.saveFirstMonths} onChange={(e) => set("saveFirstMonths", Number(e.target.value))} aria-label="Save-first months slider" className="h-11 flex-1 accent-forest-700" />
                <span className="w-24 text-right tabular-nums">{s.saveFirstMonths === 0 ? "Off" : `${s.saveFirstMonths} months`}</span>
              </div>
            </Field>
            {s.saveFirstMonths > 0 && <DecimalSlider label="Savings account APY" value={s.hysaApyPercent} onChange={(v) => set("hysaApyPercent", v)} max={10} step={0.1} suffix="%" />}
          </div>
        </Card>
      </div>

      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <Stat
              label="Paid off"
              value={result.plan.payoffDate ? monthLabel(result.plan.payoffDate.slice(0, 7)) : "Not within 50 years"}
              hint={result.plan.payoffDate ? `${futurePeriods.length} months from ${inputs.startDate}` : undefined}
            />
          </Card>
          <Card>
            <Stat label="Future interest" value={inr(planInterest)} hint={`Schedule only: ${inr(baseInterest)}`} />
          </Card>
          <Card>
            <Stat
              label="Interest saved"
              value={inr(Math.max(0, baseInterest - planInterest))}
              hint={result.baseline.payoffDate ? `Schedule only finishes ${monthLabel(result.baseline.payoffDate.slice(0, 7))}` : "Schedule alone doesn't finish"}
            />
          </Card>
        </div>

        {(result.warnings.length > 0 || (modelFinal && scheduleFinalMonth && modelFinal !== scheduleFinalMonth)) && (
          <Card title="Warnings">
            <ul className="list-disc space-y-1 pl-5 text-sm text-warn">
              {result.warnings.map((w) => (
                <li key={w.code}>{warningText(w)}</li>
              ))}
              {modelFinal && scheduleFinalMonth && modelFinal !== scheduleFinalMonth && (
                <li>
                  With only the scheduled payments, this model finishes in {monthLabel(modelFinal)}; the lender&apos;s schedule says {monthLabel(scheduleFinalMonth)}. The model is an estimate (see assumptions).
                </li>
              )}
            </ul>
          </Card>
        )}

        <Card title="How does my plan change the balance?" action={<Badge tone="warn">estimate, not lender ledger</Badge>}>
          <BalanceChart plan={result.plan.periods} baseline={result.baseline.periods} from={inputs.startDate.slice(0, 7)} />
        </Card>

        <Card title="What would it take to finish by a date?">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Finish by">
              <input type="date" value={s.targetDate ?? ""} onChange={(e) => set("targetDate", e.target.value || null)} className="h-11 rounded-xl border border-line bg-surface px-3" />
            </Field>
            {s.targetDate && (
              <p className="pb-2 text-sm">
                {required?.monthlyExtraUsdMinor == null ? (
                  <span className="text-danger">Not reachable within the model&apos;s limits.</span>
                ) : (
                  <>
                    Extra <b>{usd(required.monthlyExtraUsdMinor)}</b>/month ({inr(usdToInr(required.monthlyExtraUsdMinor, fx))}) on top of the schedule.{" "}
                    {required.affordable ? (
                      <span className="text-forest-700">Fits within the {usd(required.availableUsdMinor)} available.</span>
                    ) : (
                      <span className="font-medium text-danger">More than the {usd(required.availableUsdMinor)} available each month.</span>
                    )}
                  </>
                )}
              </p>
            )}
          </div>
          <p className="mt-2 text-xs text-faint">Assumes extras start on the start date with no save-first period.</p>
        </Card>

        {result.saveFirst && (
          <Card title="Save-first fund">
            <dl className="grid grid-cols-[12rem_1fr] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-muted">Put in</dt>
              <dd>
                {usd(result.lumpSumUsdMinor)} lump + {usd(result.saveFirst.totalContributedUsdMinor)} monthly
              </dd>
              <dt className="text-muted">Interest earned</dt>
              <dd>{usd(result.saveFirst.totalInterestUsdMinor)}</dd>
              <dt className="text-muted">Fund at the end</dt>
              <dd>{usd(result.saveFirst.fundAtEndUsdMinor)}</dd>
              <dt className="text-muted">Converted & paid</dt>
              <dd>
                {inr(result.saveFirst.convertedInrMinor)} on {result.saveFirst.appliedOn}
              </dd>
              {result.saveFirst.leftoverInrMinor > 0 && (
                <>
                  <dt className="text-muted">Left over (not needed)</dt>
                  <dd>{inr(result.saveFirst.leftoverInrMinor)}</dd>
                </>
              )}
              <dt className="text-muted">Emergency reserve</dt>
              <dd>{usd(result.saveFirst.reserveUsdMinor)} — untouched</dd>
            </dl>
          </Card>
        )}

        <Card title="Month by month">
          <details>
            <summary className="cursor-pointer text-sm text-muted">{futurePeriods.length} months from the start date</summary>
            <div className="mt-3 max-h-96 overflow-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="sticky top-0 bg-surface text-left text-xs uppercase text-faint">
                  <tr>
                    <th className="py-1 font-medium">Date</th>
                    <th className="py-1 text-right font-medium">Opening</th>
                    <th className="py-1 text-right font-medium">Interest</th>
                    <th className="py-1 text-right font-medium">Scheduled</th>
                    <th className="py-1 text-right font-medium">Extra</th>
                    <th className="py-1 text-right font-medium">Closing</th>
                  </tr>
                </thead>
                <tbody>
                  {futurePeriods.map((p) => (
                    <tr key={p.date} className={`border-t border-line/60 ${p.warnings.includes("below_interest") ? "text-warn" : ""}`}>
                      <td className="py-1 tabular-nums">{p.date}</td>
                      <td className="py-1 text-right tabular-nums">{inr(p.openingMinor)}</td>
                      <td className="py-1 text-right tabular-nums">{inr(p.interestMinor)}</td>
                      <td className="py-1 text-right tabular-nums">
                        {inr(p.requiredMinor)}
                        {p.requiredSource === "recorded" ? "*" : ""}
                      </td>
                      <td className="py-1 text-right tabular-nums">{p.extraMinor ? inr(Math.min(p.extraMinor, p.paymentMinor)) : "—"}</td>
                      <td className="py-1 text-right tabular-nums">{inr(p.closingMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-faint">* recorded payment. Rows in amber: the payment is below that month&apos;s interest, so the balance grows.</p>
            </div>
          </details>
        </Card>

        <Card title="Assumptions">
          <ul className="space-y-2 text-sm">
            {[
              ["Disbursements (₹73,84,970)", "verified", "From the lender statement."],
              ["Opening balance ₹88,26,923 on 2026-09-11", "unverified", "From the repayment schedule (imported, unverified)."],
              ["Schedule: ₹9,846/month partial interest to Aug 2027, then ₹1,29,537 EMI", "unverified", "Imported schedule; final payment Sep 2038."],
              [`Interest rate ${s.annualRatePercent}%`, "estimate", "Floating — previously stated as 11.55%."],
              ["Unpaid interest is added to the balance (capitalized)", "unverified", "Whether Credila capitalizes unpaid interest isn't confirmed."],
              ["Interest is monthly: balance × rate / 12", "estimate", "Not daily; the lender may compute differently."],
              ["Payments on/before 2026-09-11", "verified", "Already reflected in the opening balance; never subtracted again."],
              [`₹${s.fxInrPerUsd}/$, ${s.transferFeePercent}% fee, ${s.hysaApyPercent}% APY`, "estimate", "Your inputs."],
              ["Planned payments", "verified", "Never counted as paid until marked paid in the ledger."],
            ].map(([what, kind, why]) => (
              <li key={what} className="flex flex-wrap items-start gap-2">
                <Badge tone={kind === "verified" ? "forest" : "warn"}>{kind}</Badge>
                <span>
                  {what} <span className="text-muted">— {why}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
