"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { SaveStatus, type SaveState } from "@/components/save-status";
import { Select } from "@/components/select";
import { Collapsible } from "@/components/collapsible";
import { Hero, HeroChip, HeroLabel, HeroNumber, HeroRing, HeroStats } from "@/components/hero";
import { Badge, Card } from "@/components/ui";
import { monthLabel } from "@/engines/dates";
import { planPayoff, requiredMonthlyContribution, usdToInr, effectiveFx, type PlannerBase, type PlannerWarning } from "@/engines/loan/planner";
import { checkPartPayment, splitPartPayment, type PartPaymentQuote } from "@/engines/loan/part-payment";
import { linkDrift, plannerInputs, type Scenario } from "@/engines/loan/scenario";
import { formatINR, formatUSD, isParsableMinor, parseMinor } from "@/engines/money";
import { isDecimalString } from "@/engines/rational";
import { fetchFxAction, saveScenarioAction } from "@/server/actions/loan";
import { BalanceChart } from "./balance-chart";

export interface LinkOption {
  month: string;
  incomeMinor: number | null;
  expensesMinor: number | null;
  partial: boolean;
}

const usd = (m: number) => formatUSD(m, { decimals: "auto" });
const usd0 = (m: number) => formatUSD(m, { decimals: "never" });
const fillPct = (value: number, max: number) => (max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0);
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
          style={{ "--fill": `${fillPct(valueMinor / 100, Math.max(max, valueMinor / 100))}%` } as CSSProperties}
          className="range h-11 flex-1"
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
        <input type="range" min={0} max={max} step={step} value={Number(value)} onChange={(e) => onChange(e.target.value)} aria-label={`${label} slider`} style={{ "--fill": `${fillPct(Number(value), max)}%` } as CSSProperties} className="range h-11 flex-1" />
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

const rupees = (minor: number) => `₹${Math.round(minor / 100).toLocaleString("en-IN")}`;

/** The portal's Pay Now → Part payment screen: today's minimum and maximum, a try-an-amount box, and the rules. */
function PartPaymentCard({ q }: { q: PartPaymentQuote & { lastDueDate: string } }) {
  const [text, setText] = useState(String(Math.ceil(q.minimumMinor / 100)));
  const n = Number(text.replace(/[, ]/g, ""));
  const amount = Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
  const check = amount > 0 ? checkPartPayment(amount, q) : null;
  const split = amount > 0 && check?.ok ? splitPartPayment(amount, q) : null;
  return (
    <Card title="Part payment on the lender's portal" action={<Badge tone="forest">matches the portal</Badge>}>
      <dl className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-3">
        <div>
          <dt className="text-xs text-muted">Outstanding today</dt>
          <dd className="text-lg font-semibold tabular-nums">{rupees(q.outstandingMinor)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Minimum you can pay</dt>
          <dd className="text-lg font-semibold tabular-nums">{rupees(q.minimumMinor)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Maximum</dt>
          <dd className="text-lg font-semibold tabular-nums">{rupees(q.maximumMinor)}</dd>
        </div>
      </dl>
      <p className="mt-2 text-sm text-muted">
        The minimum is all the interest built up so far ({rupees(q.interestMinor)}) plus ₹1, so that at least ₹1 reaches principal. As of {q.on}.
      </p>
      <label className="mt-4 block text-sm">
        <span className="text-muted">Try an amount (₹)</span>
        <input inputMode="numeric" value={text} onChange={(e) => setText(e.target.value)} aria-label="Part payment amount in rupees" className="mt-1 h-11 w-full max-w-xs rounded-xl border border-line bg-surface px-3 outline-none focus:border-forest-600" />
      </label>
      {check && !check.ok && (
        <p role="alert" className="mt-2 text-sm text-danger">
          The portal won&apos;t accept this: {check.reason === "below_minimum" ? "below the minimum" : "above the maximum"} of {rupees(check.limitMinor)}.
        </p>
      )}
      {split && (
        <dl className="mt-3 grid max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1 rounded-xl bg-canvas px-4 py-3 text-sm tabular-nums">
          <dt className="text-muted">Principal</dt>
          <dd className="text-right">{rupees(split.principalMinor)}</dd>
          <dt className="text-muted">Interest</dt>
          <dd className="text-right">{rupees(split.interestMinor)}</dd>
          <dt className="text-muted">Charges</dt>
          <dd className="text-right">{rupees(split.chargesMinor)}</dd>
          <dt className="text-muted">Overdue</dt>
          <dd className="text-right">{rupees(split.overdueMinor)}</dd>
        </dl>
      )}
      <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm text-muted">
        <li>A payment goes to dues first, then interest, then principal.</li>
        <li>Interest is everything built up since it was last added to principal, so small payments can&apos;t be accepted.</li>
        <li>No prepayment charge applies on this floating-rate loan.</li>
        <li>Choose &ldquo;keep EMI, shorten tenure&rdquo; to finish sooner, or &ldquo;keep tenure, reduce EMI&rdquo; for lower payments.</li>
        <li>Charges, taxes and interest to the day of payment can change the exact amount.</li>
      </ol>
    </Card>
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
    case "held_below_minimum":
      return w.firstReleaseOn ? `${w.message} They are paid in one go on ${w.firstReleaseOn}.` : `${w.message} They never reach it within the plan.`;
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
  portal,
}: {
  base: PlannerBase;
  initial: { inputs: Scenario; version: number | null };
  months: LinkOption[];
  scheduleFinalMonth: string | null;
  rateNote: string;
  /** Today's lender-portal figures; null when the principal / interest split isn't known. */
  portal: (PartPaymentQuote & { lastDueDate: string }) | null;
}) {
  const [s, setS] = useState<Scenario>(initial.inputs);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const version = useRef<number | null>(initial.version);
  const first = useRef(true);
  const inflight = useRef(false);
  const pending = useRef<Scenario | null>(null);
  const deferred = useDeferredValue(s);
  const set = <K extends keyof Scenario>(k: K, v: Scenario[K]) => setS((p) => ({ ...p, [k]: v }));

  // Live ₹ per $. In "auto" mode it is fetched each time the planner opens; typing or sliding the rate switches to "manual".
  type FxInfo = { kind: "idle" } | { kind: "loading" } | { kind: "live"; date: string; source: string } | { kind: "failed"; message: string };
  const [live, setLive] = useState<FxInfo>({ kind: "idle" });
  async function refreshFx() {
    // Let go of the number box so it shows the fetched rate rather than what was last typed.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setLive({ kind: "loading" });
    try {
      const r = await fetchFxAction();
      if (r.ok) {
        setS((p) => ({ ...p, fxInrPerUsd: r.data.rate, fxMode: "auto" }));
        setLive({ kind: "live", date: r.data.date, source: r.data.source });
      } else {
        setLive({ kind: "failed", message: r.message });
      }
    } catch {
      setLive({ kind: "failed", message: "couldn't reach the exchange-rate service" });
    }
  }
  const fxFetchedOnOpen = useRef(false);
  useEffect(() => {
    if (fxFetchedOnOpen.current) return;
    fxFetchedOnOpen.current = true;
    if (initial.inputs.fxMode === "auto") void refreshFx();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  // Numbers for the "What this plan costs" table: the plan vs the lender's schedule, from the start date on.
  const baselineFuture = result.baseline.periods.filter((p) => p.date >= inputs.startDate);
  const sumOf = (ps: typeof futurePeriods, f: (p: (typeof futurePeriods)[number]) => number) => ps.reduce((a, p) => a + f(p), 0);
  const costs = {
    plan: { months: futurePeriods.length, paid: sumOf(futurePeriods, (p) => p.paymentMinor), interest: sumOf(futurePeriods, (p) => p.interestMinor), end: result.plan.payoffDate },
    base: { months: baselineFuture.length, paid: sumOf(baselineFuture, (p) => p.paymentMinor), interest: sumOf(baselineFuture, (p) => p.interestMinor), end: result.baseline.payoffDate },
  };
  const rate = Number(result.effectiveInrPerUsd) || 1;
  const toUsd = (inrMinor: number) => Math.round(inrMinor / rate);
  // Only the years your plan is still paying; the schedule-only balance is shown alongside.
  const yearRows = [...new Set(futurePeriods.map((p) => p.date.slice(0, 4)))].sort().map((y) => {
    const a = futurePeriods.filter((p) => p.date.startsWith(y));
    const b = baselineFuture.filter((p) => p.date.startsWith(y));
    return { year: y, months: a.length, paid: sumOf(a, (p) => p.paymentMinor), interest: sumOf(a, (p) => p.interestMinor), end: a.length ? a.at(-1)!.closingMinor : 0, baseEnd: b.length ? b.at(-1)!.closingMinor : 0 };
  });
  const sooner = costs.base.months - costs.plan.months;
  const soonerText = sooner > 0 ? `${Math.floor(sooner / 12) > 0 ? `${Math.floor(sooner / 12)} yr ` : ""}${sooner % 12 > 0 ? `${sooner % 12} mo` : ""} sooner`.trim() : "—";

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
            <MoneySlider label="Lump sum to the loan" valueMinor={s.lumpSumUsdMinor} onChange={(m) => set("lumpSumUsdMinor", Math.min(m, maxLump))} max={maxLump / 100} step={500} hint={maxLump > 0 ? `At most ${usd(maxLump)} (existing savings − reserve).` : "Can't move yet: the lump sum comes out of existing savings above your reserve. Raise existing savings first."} />
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <button type="button" disabled={maxLump === 0} onClick={() => set("lumpSumUsdMinor", maxLump)} className="h-9 rounded-lg border border-line bg-surface px-3 font-medium transition hover:bg-forest-50 disabled:opacity-50">
                Use all of it{maxLump > 0 ? ` (${usd(maxLump)})` : ""}
              </button>
              <span className="text-xs text-muted">Existing savings and the reserve only matter through the lump sum.</span>
            </div>
          </div>
        </Card>

        <Card title="Loan & conversion">
          <div className="space-y-4">
            <DecimalSlider label="Interest rate (annual)" value={s.annualRatePercent} onChange={(v) => set("annualRatePercent", v)} max={20} step={0.05} suffix="%" hint={rateNote} />
            <DecimalSlider
              label="₹ per $"
              value={s.fxInrPerUsd}
              onChange={(v) => setS((p) => ({ ...p, fxInrPerUsd: v, fxMode: "manual" }))}
              max={120}
              step={0.5}
              suffix="₹"
              hint={
                <span className="block space-y-1.5">
                  <span className="block">
                    {s.fxMode === "auto"
                      ? live.kind === "live"
                        ? `Live rate: ₹${s.fxInrPerUsd} per $ — ${live.source}, ${live.date}. It refreshes every time you open the planner; change the number to use your own.`
                        : live.kind === "loading"
                          ? "Fetching the live rate…"
                          : live.kind === "failed"
                            ? `Couldn't fetch the live rate (${live.message}); using ₹${s.fxInrPerUsd}.`
                            : `Using ₹${s.fxInrPerUsd}; the live rate loads when you open this page.`
                      : "Your own rate — it stays as you set it until you press the button."}
                  </span>
                  <button
                    type="button"
                    onClick={() => void refreshFx()}
                    disabled={live.kind === "loading"}
                    className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink transition hover:bg-forest-50 disabled:opacity-60"
                  >
                    <svg aria-hidden="true" viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={live.kind === "loading" ? "animate-spin" : ""}>
                      <path d="M16 10a6 6 0 1 1-1.8-4.3M16 4v3.5h-3.5" />
                    </svg>
                    {s.fxMode === "auto" ? "Refresh live rate" : "Use live rate"}
                  </button>
                </span>
              }
            />
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
            <fieldset className="space-y-2 text-sm">
              <legend className="mb-1 font-medium">After a part payment</legend>
              {(
                [
                  ["shorten_tenure", "Keep EMI, shorten tenure", "The EMI stays ₹1,29,537; you finish sooner and pay the least interest."],
                  ["reduce_emi", "Keep tenure, reduce EMI", `The loan still ends in ${scheduleFinalMonth ?? "the lender's final month"}; each month's EMI is recalculated lower.`],
                ] as const
              ).map(([value, title, hint]) => (
                <label key={value} className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${s.afterPartPayment === value ? "border-forest-600 bg-forest-50" : "border-line"}`}>
                  <input type="radio" name="afterPartPayment" value={value} checked={s.afterPartPayment === value} onChange={() => set("afterPartPayment", value)} className="mt-1 accent-forest-700" />
                  <span>
                    <span className="block font-medium">{title}</span>
                    <span className="block text-xs text-muted">{hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <Field label="Start date">
              <input type="date" value={s.startDate} onChange={(e) => e.target.value && set("startDate", e.target.value)} className="h-11 rounded-xl border border-line bg-surface px-3" />
            </Field>
            <Field label="Save first, then repay" hint="Keep extras (and the lump sum) in a high-yield savings account for N months, then convert and pay it in one go. Scheduled payments continue meanwhile. 0 = pay straight away.">
              <div className="flex items-center gap-3">
                <input type="range" min={0} max={36} value={s.saveFirstMonths} onChange={(e) => set("saveFirstMonths", Number(e.target.value))} aria-label="Save-first months slider" style={{ "--fill": `${fillPct(s.saveFirstMonths, 36)}%` } as CSSProperties} className="range h-11 flex-1" />
                <span className="w-24 text-right tabular-nums">{s.saveFirstMonths === 0 ? "Off" : `${s.saveFirstMonths} months`}</span>
              </div>
            </Field>
            {s.saveFirstMonths > 0 && <DecimalSlider label="Savings account APY" value={s.hysaApyPercent} onChange={(v) => set("hysaApyPercent", v)} max={10} step={0.1} suffix="%" />}
          </div>
        </Card>
      </div>

      <div className="space-y-6">
        <Hero>
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
            <div className="min-w-0">
              <HeroLabel>Paid off</HeroLabel>
              <HeroNumber>{result.plan.payoffDate ? monthLabel(result.plan.payoffDate.slice(0, 7)) : "Not within 50 years"}</HeroNumber>
              <p className="mt-4 flex flex-wrap items-center gap-2 text-sm text-[#d8e8dd]">
                <HeroChip>Estimate</HeroChip>
                {result.plan.payoffDate && <span>{futurePeriods.length} months from {inputs.startDate}</span>}
              </p>
            </div>
            <HeroRing
              fraction={baseInterest > 0 ? Math.max(0, baseInterest - planInterest) / baseInterest : 0}
              label={`${baseInterest > 0 ? Math.round((Math.max(0, baseInterest - planInterest) / baseInterest) * 100) : 0}%`}
              caption="of future interest saved"
              ariaLabel="Share of future interest saved by the plan"
            />
          </div>
          <HeroStats
            items={[
              { label: "Future interest", value: inr(planInterest), hint: `Schedule only: ${inr(baseInterest)}` },
              {
                label: "Interest saved",
                value: inr(Math.max(0, baseInterest - planInterest)),
                hint: result.baseline.payoffDate ? `Schedule only finishes ${monthLabel(result.baseline.payoffDate.slice(0, 7))}` : "Schedule alone doesn't finish",
              },
            ]}
          />
        </Hero>

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

        <Card title="What this plan costs" action={<Badge tone="forest">updates as you move the sliders</Badge>}>
          <Collapsible defaultOpen title="Show the numbers" meta="plan vs lender's schedule">
            <p className="text-sm">
              First payment from the start date: scheduled <b className="tabular-nums">{inr(futurePeriods[0]?.requiredMinor ?? 0)}</b> + extra <b className="tabular-nums">{inr(result.monthlyExtraInrMinor)}</b>
              {" "}= <b className="tabular-nums">{inr((futurePeriods[0]?.requiredMinor ?? 0) + result.monthlyExtraInrMinor)}</b> (about {usd0(toUsd((futurePeriods[0]?.requiredMinor ?? 0) + result.monthlyExtraInrMinor))}).
            </p>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-faint">
                  <tr>
                    <th className="py-1 font-medium"> </th>
                    <th className="py-1 text-right font-medium">Your plan</th>
                    <th className="py-1 text-right font-medium">Lender&apos;s schedule</th>
                    <th className="hidden py-1 text-right font-medium sm:table-cell">Difference</th>
                  </tr>
                </thead>
                <tbody className="[&_td]:border-t [&_td]:border-line/60 [&_td]:py-1.5">
                  <tr>
                    <td className="text-muted">Loan paid off</td>
                    <td className="text-right font-medium tabular-nums">{costs.plan.end ? monthLabel(costs.plan.end.slice(0, 7), "short") : "—"}</td>
                    <td className="text-right tabular-nums">{costs.base.end ? monthLabel(costs.base.end.slice(0, 7), "short") : "—"}</td>
                    <td className="hidden text-right tabular-nums text-brand sm:table-cell">{soonerText}</td>
                  </tr>
                  <tr>
                    <td className="text-muted">Payments left</td>
                    <td className="text-right font-medium tabular-nums">{costs.plan.months}</td>
                    <td className="text-right tabular-nums">{costs.base.months}</td>
                    <td className="hidden text-right tabular-nums text-brand sm:table-cell">{sooner > 0 ? `${sooner} fewer` : "—"}</td>
                  </tr>
                  <tr>
                    <td className="text-muted">Interest from here</td>
                    <td className="text-right font-medium tabular-nums">{inr(costs.plan.interest)}</td>
                    <td className="text-right tabular-nums">{inr(costs.base.interest)}</td>
                    <td className="hidden text-right tabular-nums text-brand sm:table-cell">{costs.base.interest > costs.plan.interest ? `${inr(costs.base.interest - costs.plan.interest)} less` : "—"}</td>
                  </tr>
                  <tr>
                    <td className="text-muted">You pay in total</td>
                    <td className="text-right font-medium tabular-nums">{inr(costs.plan.paid)}</td>
                    <td className="text-right tabular-nums">{inr(costs.base.paid)}</td>
                    <td className="hidden text-right tabular-nums text-brand sm:table-cell">{costs.base.paid > costs.plan.paid ? `${inr(costs.base.paid - costs.plan.paid)} less` : "—"}</td>
                  </tr>
                  <tr>
                    <td className="text-muted">…in dollars (at ₹{result.effectiveInrPerUsd}/$)</td>
                    <td className="text-right font-medium tabular-nums">{usd0(toUsd(costs.plan.paid))}</td>
                    <td className="text-right tabular-nums">{usd0(toUsd(costs.base.paid))}</td>
                    <td className="hidden text-right tabular-nums text-brand sm:table-cell">{costs.base.paid > costs.plan.paid ? `${usd0(toUsd(costs.base.paid - costs.plan.paid))} less` : "—"}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 className="mt-5 text-sm font-semibold">Year by year</h3>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-faint">
                  <tr>
                    <th className="py-1 font-medium">Year</th>
                    <th className="py-1 text-right font-medium">You pay</th>
                    <th className="py-1 text-right font-medium">Interest</th>
                    <th className="py-1 text-right font-medium">Balance at year end</th>
                    <th className="hidden py-1 text-right font-medium sm:table-cell">Schedule only</th>
                  </tr>
                </thead>
                <tbody className="[&_td]:border-t [&_td]:border-line/60 [&_td]:py-1.5">
                  {yearRows.map((r) => (
                    <tr key={r.year}>
                      <td className="tabular-nums">
                        {r.year}
                        {r.months > 0 && r.months < 12 && <span className="text-xs text-faint"> · {r.months} mo</span>}
                      </td>
                      <td className="text-right tabular-nums">
                        {r.months ? inr(r.paid) : "—"}
                        {r.months > 0 && <span className="block text-xs text-faint">{usd0(toUsd(r.paid))}</span>}
                      </td>
                      <td className="text-right tabular-nums">{r.months ? inr(r.interest) : "—"}</td>
                      <td className="text-right font-medium tabular-nums">{r.months ? inr(r.end) : "Paid off"}</td>
                      <td className="hidden text-right tabular-nums text-muted sm:table-cell">{r.baseEnd ? inr(r.baseEnd) : "Paid off"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-line font-semibold">
                    <td className="py-1.5">Total</td>
                    <td className="py-1.5 text-right tabular-nums">{inr(costs.plan.paid)}</td>
                    <td className="py-1.5 text-right tabular-nums">{inr(costs.plan.interest)}</td>
                    <td className="py-1.5"> </td>
                    <td className="hidden sm:table-cell"> </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="mt-3 text-xs text-faint">
              Interest is charged every month on the whole balance. While the payment is below that month&apos;s interest (before the EMI starts), the balance goes up, not down. Rupee amounts are estimates; dollars use your rate and fee.
            </p>
          </Collapsible>
        </Card>

        {portal && <PartPaymentCard q={portal} />}

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
                      <span className="text-brand">Fits within the {usd(required.availableUsdMinor)} available.</span>
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
            <dl className="grid gap-x-3 gap-y-1 text-sm sm:grid-cols-[12rem_1fr] [&>dd]:mb-2 sm:[&>dd]:mb-0">
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
          <Collapsible title="Every month from the start date" meta={`${futurePeriods.length} months`}>
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface text-left text-xs uppercase text-faint">
                  <tr>
                    <th className="py-1 font-medium">Date</th>
                    <th className="hidden py-1 text-right font-medium sm:table-cell">Opening</th>
                    <th className="py-1 text-right font-medium">Interest</th>
                    <th className="hidden py-1 text-right font-medium sm:table-cell">Scheduled</th>
                    <th className="hidden py-1 text-right font-medium sm:table-cell">Extra</th>
                    <th className="py-1 text-right font-medium">Closing</th>
                  </tr>
                </thead>
                <tbody>
                  {futurePeriods.map((p) => (
                    <tr key={p.date} className={`border-t border-line/60 ${p.warnings.includes("below_interest") ? "text-warn" : ""}`}>
                      <td className="py-1 tabular-nums">{p.date}</td>
                      <td className="hidden py-1 text-right tabular-nums sm:table-cell">{inr(p.openingMinor)}</td>
                      <td className="py-1 text-right tabular-nums">{inr(p.interestMinor)}</td>
                      <td className="hidden py-1 text-right tabular-nums sm:table-cell">
                        {inr(p.requiredMinor)}
                        {p.requiredSource === "recorded" ? "*" : ""}
                      </td>
                      <td className="hidden py-1 text-right tabular-nums sm:table-cell">
                        {p.extraMinor ? inr(Math.min(p.extraMinor, p.paymentMinor)) : p.heldMinor ? <span className="text-faint">held {inr(p.heldMinor)}</span> : "—"}
                      </td>
                      <td className="py-1 text-right tabular-nums">{inr(p.closingMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-faint">* recorded payment. Rows in amber: the payment is below that month&apos;s interest, so the balance grows. &ldquo;held&rdquo;: your extra is waiting to reach the portal&apos;s part-payment minimum.</p>
            </div>
          </Collapsible>
        </Card>

        <Card title="Assumptions">
          <ul className="space-y-2 text-sm">
            {[
              ["Disbursements (₹73,84,970 of ₹75,00,000 sanctioned)", "verified", "Lender transaction history; ₹1,15,030 is still available to withdraw."],
              [`Outstanding ${inr(base.openingBalanceMinor)} after the ${base.asOf} instalment`, "verified", "The lender's repayment schedule issued 2026-11-16."],
              ["₹9,846/month partial interest to Aug 2027, then a ₹1,29,537 EMI; final payment Jan 2039 (174 instalments)", "verified", "The same schedule; the model reproduces it to within ₹3 a month."],
              [`Interest rate ${s.annualRatePercent}%`, "verified", "Credila's rate today (CBLR 14.1% − 2.3%). Floating: change it here to test scenarios."],
              ["Interest is the balance × rate ÷ 12 each month, to the whole rupee", "verified", "Loan agreement cl. 2.3(b); the lender's schedule follows it."],
              ["Unpaid interest is added to the balance every month", "verified", "Cl. 2.3(i), and visible in the schedule's outstanding column."],
              ["Part payments must exceed the interest built up, and are applied to interest first", "verified", "The portal's minimum and its ₹3,16,000 → ₹3,15,605 interest + ₹395 principal example."],
              ["Interest is added to principal when the EMI starts (Sep 2027)", "estimate", "The lender's schedule does this; the exact roll-up rule isn't published."],
              ["No prepayment or foreclosure charge", "verified", "Cl. 2.9(a): none on floating-rate loans."],
              ["A part payment is made on a due date", "estimate", "The portal lets you pay any day; interest to that day is then added."],
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
