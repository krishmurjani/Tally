/** CSV exports (amounts as exact decimal strings). Read-only. */
import { todayNY } from "@/engines/dates";
import { effectiveStatus } from "@/engines/loan/ledger";
import { planPayoff, type PlannerBase } from "@/engines/loan/planner";
import { defaultScenario, plannerInputs } from "@/engines/loan/scenario";
import { minorToDecimalString } from "@/engines/money";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./db/schema";
import { loadMonthView, monthlySeries } from "./month-data";
import type { Owner } from "./owner-core";
import { listIncome } from "./repos/income";
import { loadLoanFacts, loadLoanLedgers, loadScenario } from "./repos/loan";

type AnyDb = NodePgDatabase<typeof schema>;

/** RFC 4180 cell. Text cells starting with = + - @ are prefixed with ' so spreadsheets don't run them as formulas. */
export function cell(v: string | number | null | undefined, kind: "text" | "value" = "value"): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (kind === "text" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: (string | number | null)[][], textCols: number[] = []): string {
  const t = new Set(textCols);
  return [header.join(","), ...rows.map((r) => r.map((c, i) => cell(c, t.has(i) ? "text" : "value")).join(","))].join("\n") + "\n";
}

const amt = (m: number | null) => (m === null ? "" : minorToDecimalString(m));

export const EXPORT_KINDS = ["expenses", "category-summaries", "income", "lender-payments", "reimbursements", "projection"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export async function exportCsv(db: AnyDb, owner: Owner, kind: ExportKind): Promise<string> {
  switch (kind) {
    case "expenses": {
      const series = await monthlySeries(db, owner);
      const rows: (string | number | null)[][] = [];
      for (const p of series.filter((x) => x.kind === "detailed" && x.hasSpending)) {
        const v = await loadMonthView(db, owner, p.month);
        for (const r of [...v.rows].reverse()) {
          rows.push([p.month, r.date, r.description, r.category ?? "Needs category", amt(r.status === "included" ? r.shareMinor : 0), amt(r.costMinor), r.currency, r.group, r.status, r.reasonText, r.source, v.status]);
        }
      }
      return toCsv(["month", "date", "description", "category", "my_share_usd", "full_cost", "currency", "group", "status", "reason", "source", "month_status"], rows, [2, 3, 7, 9]);
    }
    case "category-summaries": {
      const series = await monthlySeries(db, owner);
      const rows = series.filter((p) => p.hasSpending).flatMap((p) => Object.entries(p.byCategory).map(([c, m]) => [p.month, c, amt(m), p.kind, p.partial ? "partial" : ""]));
      return toCsv(["month", "category", "amount_usd", "kind", "partial"], rows, [1]);
    }
    case "income": {
      const entries = await listIncome(db, owner);
      return toCsv(["date", "take_home_usd", "employer", "note"], entries.map((e) => [e.date, amt(e.amountMinor), e.employer, e.note]), [2, 3]);
    }
    case "lender-payments": {
      const { payments } = await loadLoanLedgers(db, owner);
      const today = todayNY();
      return toCsv(
        ["due_date", "paid_date", "amount_inr", "payer", "type", "status", "status_today", "interest_inr", "principal_inr", "reference", "note"],
        payments.map((p) => [p.dueDate, p.paidDate, amt(p.amountMinor), p.payer, p.type, p.status, effectiveStatus(p, today), amt(p.interestMinor), amt(p.principalMinor), p.reference ?? null, p.note ?? null]),
        [9, 10],
      );
    }
    case "reimbursements": {
      const { reimbursements } = await loadLoanLedgers(db, owner);
      return toCsv(["date", "amount_inr", "kind", "note"], reimbursements.map((r) => [r.date, amt(r.amountMinor), r.kind, r.note ?? null]), [3]);
    }
    case "projection": {
      const [{ rates, schedule }, { payments }, saved] = await Promise.all([loadLoanFacts(db, owner), loadLoanLedgers(db, owner), loadScenario(db, owner)]);
      const today = todayNY();
      const rate = ([...rates].filter((r) => r.effectiveFrom <= today).at(-1) ?? rates[0])?.annualPercent ?? "11.55";
      const base: PlannerBase = { openingBalanceMinor: schedule.openingBalanceMinor, asOf: schedule.asOf, paymentDay: schedule.paymentDay, phases: schedule.phases, recordedPayments: payments, maxMonths: 600 };
      const r = planPayoff(base, plannerInputs(saved?.inputs ?? defaultScenario(today, rate)));
      const baseline = new Map(r.baseline.periods.map((p) => [p.date, p.closingMinor]));
      return toCsv(
        ["date", "opening_inr", "rate_percent", "interest_inr", "scheduled_inr", "scheduled_source", "extra_inr", "payment_inr", "closing_inr", "schedule_only_closing_inr", "warnings", "estimate"],
        r.plan.periods.map((p) => [p.date, amt(p.openingMinor), p.annualPercent, amt(p.interestMinor), amt(p.requiredMinor), p.requiredSource, amt(p.extraMinor), amt(p.paymentMinor), amt(p.closingMinor), amt(baseline.get(p.date) ?? null), p.warnings.join(" "), "estimate, not lender ledger"]),
      );
    }
  }
}
