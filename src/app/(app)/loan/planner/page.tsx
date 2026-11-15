import type { Metadata } from "next";
import { todayNY } from "@/engines/dates";
import { defaultScenario } from "@/engines/loan/scenario";
import type { PlannerBase } from "@/engines/loan/planner";
import { requireOwnerOrRedirect } from "@/server/auth-guard";
import { getDb } from "@/server/db/client";
import { monthlySeries } from "@/server/month-data";
import { loadLoanFacts, loadLoanLedgers, loadScenario } from "@/server/repos/loan";
import { Planner, type LinkOption } from "./planner";

export const metadata: Metadata = { title: "Payoff planner" };

export default async function PlannerPage() {
  const owner = await requireOwnerOrRedirect();
  const db = getDb();
  const [{ rates, schedule }, { payments }, saved, series] = await Promise.all([loadLoanFacts(db, owner), loadLoanLedgers(db, owner), loadScenario(db, owner), monthlySeries(db, owner)]);
  const today = todayNY();
  const currentRate = ([...rates].filter((r) => r.effectiveFrom <= today).at(-1) ?? rates[0])?.annualPercent ?? "11.55";
  const base: PlannerBase = {
    openingBalanceMinor: schedule.openingBalanceMinor,
    asOf: schedule.asOf,
    paymentDay: schedule.paymentDay,
    phases: schedule.phases,
    recordedPayments: payments.map(({ version: _v, interestMinor: _i, principalMinor: _p, ...p }) => p),
    maxMonths: 600,
  };
  const months: LinkOption[] = [...series]
    .reverse()
    .map((p) => ({ month: p.month, incomeMinor: p.incomeMinor, expensesMinor: p.hasSpending ? p.totalMinor : null, partial: p.partial }));
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        An estimate, not the lender&apos;s ledger. Changes save automatically. Recorded payments up to today come from the payments ledger; from the start date on, the schedule plus your extras apply.
      </p>
      <Planner
        base={base}
        initial={saved ? { inputs: saved.inputs, version: saved.version } : { inputs: defaultScenario(today, currentRate), version: null }}
        months={months}
        scheduleFinalMonth={schedule.finalPaymentMonth}
        rateNote={`Current recorded rate: ${currentRate}% (floating). Change it here to test scenarios; record real changes on the Overview tab.`}
      />
    </div>
  );
}
