import type { Metadata } from "next";
import Link from "next/link";
import { todayNY } from "@/engines/dates";
import { amortize } from "@/engines/loan/amortize";
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
  const balanceToday = toToday.at(-1)?.closingMinor ?? schedule.openingBalanceMinor;
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
              <HeroChip>Estimate, not lender ledger</HeroChip>
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

      <Card title="Sanction & disbursements" action={<Provenance label="lender statement" />}>
        <p className="mb-3 text-sm">
          Sanctioned {formatINR(loan.sanctionedMinor)} <span className="text-muted">({loan.provenance})</span> · Disbursed {formatINR(disbursed)}
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
