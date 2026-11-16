import type { Metadata } from "next";
import Link from "next/link";
import { todayNY } from "@/engines/dates";
import { amortize } from "@/engines/loan/amortize";
import { LENDER_SCHEDULE_ISSUED, lenderMonths } from "@/engines/loan/lender-schedule";
import { portalView, rollupDate } from "@/engines/loan/portal";
import { effectiveStatus, paidTotals } from "@/engines/loan/ledger";
import { sisterLedger } from "@/engines/loan/sister";
import { formatINR } from "@/engines/money";
import { Hero, HeroChip, HeroLabel, HeroNumber, HeroStats } from "@/components/hero";
import { Badge, Card } from "@/components/ui";
import { requireOwnerOrRedirect } from "@/server/auth-guard";
import { getDb } from "@/server/db/client";
import { loadLoanFacts, loadLoanLedgers } from "@/server/repos/loan";
import { RateForm } from "./rate-form";

export const metadata: Metadata = { title: "Loan" };

function Provenance({ label }: { label: string }) {
  const verified = label === "lender statement";
  return <Badge tone={verified ? "forest" : "warn"}>{label}</Badge>;
}

export default async function LoanPage() {
  const owner = await requireOwnerOrRedirect();
  const db = getDb();
  const [{ loan, rates, disbursements, schedule }, { payments, reimbursements }] = await Promise.all([loadLoanFacts(db, owner), loadLoanLedgers(db, owner)]);
  const today = todayNY();
  const totals = paidTotals(payments);
  const sister = sisterLedger(payments, reimbursements);
  const disbursed = disbursements.reduce((s, d) => s + d.amountMinor, 0);
  // Estimated balance today: opening balance rolled forward with recorded payments only.
  const toToday = amortize({
    openingBalanceMinor: schedule.openingBalanceMinor,
    asOf: schedule.asOf,
    paymentDay: schedule.paymentDay,
    rates: rates.map((r) => ({ effectiveFrom: r.effectiveFrom, annualPercent: r.annualPercent })),
    phases: schedule.phases,
    projectFrom: "9999-12-31",
    recordedPayments: payments,
    maxMonths: 600,
  }).periods.filter((p) => p.date <= today);
  const portal = portalView(
    {
      openingBalanceMinor: schedule.openingBalanceMinor,
      asOf: schedule.asOf,
      paymentDay: schedule.paymentDay,
      phases: schedule.phases,
      rates: rates.map((r) => ({ effectiveFrom: r.effectiveFrom, annualPercent: r.annualPercent })),
      principalAtRollupMinor: schedule.principalAtRollupMinor,
      rollupOn: rollupDate(schedule.phases),
      payments: payments.map(({ version: _v, interestMinor: _i, principalMinor: _p, ...p }) => p),
    },
    today,
  );
  // With the principal / interest split known this is the lender portal's own figure (interest to today included).
  const balanceToday = portal?.quote.outstandingMinor ?? toToday.at(-1)?.closingMinor ?? schedule.openingBalanceMinor;
  const history = lenderMonths().filter((m) => m.date <= LENDER_SCHEDULE_ISSUED);
  const interestAccrued = history.reduce((a, m) => a + m.interestAccruedMinor, 0);
  const interestPaid = history.reduce((a, m) => a + m.interestPaidMinor, 0);
  const available = Math.max(0, loan.sanctionedMinor - disbursed);
  const next = payments.filter((p) => p.status === "planned").sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))[0];
  const overdue = payments.filter((p) => effectiveStatus(p, today) === "overdue");
  const currentRate = [...rates].filter((r) => r.effectiveFrom <= today).at(-1) ?? rates[0];

  return (
    <div className="space-y-6">
      {overdue.length > 0 && (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger-50 px-4 py-3 text-sm text-danger">
          {overdue.length} planned payment{overdue.length === 1 ? " is" : "s are"} past due and not marked paid.{" "}
          <Link href="/loan/payments" className="font-medium underline">
            Review payments
          </Link>
        </p>
      )}
      <Hero>
        <div>
          <div className="min-w-0">
            <HeroLabel>Estimated balance today</HeroLabel>
            <HeroNumber>{formatINR(balanceToday, { decimals: "never" })}</HeroNumber>
            <p className="mt-4 flex flex-wrap items-center gap-2 text-sm text-[#d8e8dd]">
              <HeroChip>{portal ? "Matches the lender's portal" : "Estimate, not lender ledger"}</HeroChip>
              {currentRate && <span>at {currentRate.annualPercent}% floating</span>}
            </p>
          </div>
        </div>
        <HeroStats
          items={[
            { label: "Next payment", value: next ? formatINR(next.amountMinor) : "None planned", hint: next ? `Due ${next.dueDate} · planned, not paid` : undefined },
            { label: "Paid to lender so far", value: formatINR(totals.totalPaidMinor, { decimals: "never" }), hint: `${formatINR(totals.byPayer.krish, { decimals: "never" })} by me · ${formatINR(totals.byPayer.sister, { decimals: "never" })} by sister` },
            { label: "Owed to sister", value: formatINR(sister.owedMinor, { decimals: "never" }), hint: sister.creditMinor ? `Credit ${formatINR(sister.creditMinor)}` : `Funded ${formatINR(sister.fundedMinor, { decimals: "never" })}` },
          ]}
        />
      </Hero>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Repayment schedule" action={<Provenance label={schedule.provenance} />}>
          <dl className="grid gap-x-3 gap-y-1 text-sm sm:grid-cols-[11rem_1fr] sm:gap-y-2 [&_dd]:mb-2 sm:[&_dd]:mb-0">
            <dt className="text-muted">Issued</dt>
            <dd>{schedule.issuedOn}</dd>
            <dt className="text-muted">Opening outstanding</dt>
            <dd>
              {formatINR(schedule.openingBalanceMinor)} as of {schedule.asOf}
            </dd>
            {schedule.phases.map((p) => (
              <div key={p.from} className="contents">
                <dt className="text-muted">{p.label ?? p.kind}</dt>
                <dd>
                  {formatINR(p.paymentMinor)}/month from {p.from}
                </dd>
              </div>
            ))}
            <dt className="text-muted">Partial interest through</dt>
            <dd>{schedule.partialInterestThrough ?? "—"}</dd>
            <dt className="text-muted">Final payment</dt>
            <dd>{schedule.finalPaymentMonth ?? "—"}</dd>
            {schedule.tenureMonths !== null && (
              <>
                <dt className="text-muted">Tenure</dt>
                <dd>{schedule.tenureMonths} instalments</dd>
              </>
            )}
          </dl>
          <p className="mt-3 text-xs text-faint">Payments aren&apos;t labelled as interest unless the lender&apos;s allocation is entered on the payment.</p>
        </Card>
        <Card title="Interest rate" action={<Badge tone="warn">floating</Badge>}>
          <ul className="space-y-1 text-sm">
            {rates.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <b>{r.annualPercent}%</b> from {r.effectiveFrom}
                  {r.note ? <span className="text-muted"> · {r.note}</span> : null}
                </span>
                <Provenance label={r.provenance} />
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-muted">Current: {currentRate ? `${currentRate.annualPercent}%` : "—"}</p>
          <div className="mt-3">
            <RateForm />
          </div>
        </Card>
      </div>

      {portal && (
        <Card title="Part payment" action={<Provenance label="lender statement" />}>
          <p className="text-sm">
            The portal lets you part-pay from <b className="tabular-nums">{formatINR(portal.quote.minimumMinor, { decimals: "never" })}</b> up to <b className="tabular-nums">{formatINR(portal.quote.maximumMinor, { decimals: "never" })}</b> (as of {portal.quote.on}).
          </p>
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-muted">
            <li>
              The minimum is the {formatINR(portal.quote.interestMinor, { decimals: "never" })} of interest built up since {schedule.rollupThrough ?? "it was last added to principal"}, plus ₹1.
            </li>
            <li>Payments go to dues, then interest, then principal — so the first {formatINR(portal.quote.interestMinor, { decimals: "never" })} never reduces principal.</li>
            <li>Unpaid interest keeps compounding monthly, so the minimum grows until the EMI starts and it&apos;s added to principal.</li>
            <li>There is no prepayment charge. You choose: keep the EMI and finish sooner, or keep the tenure and lower the EMI.</li>
          </ol>
          <p className="mt-3 text-sm">
            <Link href="/loan/planner" className="font-medium text-brand hover:underline">
              Plan a part payment →
            </Link>
          </p>
        </Card>
      )}

      <Card title="Interest so far" action={<Provenance label="lender statement" />}>
        <dl className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-3">
          <div>
            <dt className="text-xs text-muted">Charged since Aug 2024</dt>
            <dd className="text-lg font-semibold tabular-nums">{formatINR(interestAccrued, { decimals: "never" })}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">You&apos;ve paid</dt>
            <dd className="text-lg font-semibold tabular-nums">{formatINR(interestPaid, { decimals: "never" })}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Added to the balance (unpaid)</dt>
            <dd className="text-lg font-semibold tabular-nums">{formatINR(interestAccrued - interestPaid, { decimals: "never" })}</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-faint">Your instalments so far have been interest only, so none has reduced the loan. The unpaid part is added to the balance each month and itself earns interest.</p>
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-muted">Month by month ({history.length} months)</summary>
          <div className="mt-3 max-h-96 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface text-left text-xs uppercase text-faint">
                <tr>
                  <th className="py-1 font-medium">Due</th>
                  <th className="py-1 text-right font-medium">Charged</th>
                  <th className="py-1 text-right font-medium">Paid</th>
                  <th className="hidden py-1 text-right font-medium sm:table-cell">Added</th>
                  <th className="hidden py-1 text-right font-medium sm:table-cell">Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {[...history].reverse().map((m) => (
                  <tr key={m.date} className="border-t border-line/60">
                    <td className="py-1 tabular-nums">{m.date}</td>
                    <td className="py-1 text-right tabular-nums">{formatINR(m.interestAccruedMinor, { decimals: "never" })}</td>
                    <td className="py-1 text-right tabular-nums">{formatINR(m.interestPaidMinor, { decimals: "never" })}</td>
                    <td className="hidden py-1 text-right tabular-nums sm:table-cell">{formatINR(m.unpaidAddedMinor, { decimals: "never" })}</td>
                    <td className="hidden py-1 text-right tabular-nums sm:table-cell">{formatINR(m.outstandingMinor, { decimals: "never" })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </Card>

      <Card title="Sanction & disbursements" action={<Provenance label="lender statement" />}>
        <p className="mb-3 text-sm">
          Sanctioned {formatINR(loan.sanctionedMinor)} <span className="text-muted">({loan.provenance})</span> · Disbursed {formatINR(disbursed)}
          {available > 0 && <span className="text-muted"> · Still available to withdraw {formatINR(available)}</span>}
        </p>
        <ul className="divide-y divide-line/70 text-sm">
          {disbursements.map((d) => (
            <li key={d.id} className="flex justify-between py-1.5">
              <span>
                {d.date} <span className="text-muted">· {d.note}</span>
              </span>
              <span className="tabular-nums">{formatINR(d.amountMinor)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
