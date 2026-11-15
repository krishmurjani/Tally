import type { Metadata } from "next";
import { paidTotals } from "@/engines/loan/ledger";
import { sisterLedger } from "@/engines/loan/sister";
import { formatINR } from "@/engines/money";
import { Badge, Card, Stat } from "@/components/ui";
import { requireOwnerOrRedirect } from "@/server/auth-guard";
import { getDb } from "@/server/db/client";
import { loadLoanLedgers } from "@/server/repos/loan";

export const metadata: Metadata = { title: "Loan" };

export default async function LoanPage() {
  const owner = await requireOwnerOrRedirect();
  const { payments, reimbursements } = await loadLoanLedgers(getDb(), owner);
  const totals = paidTotals(payments);
  const sister = sisterLedger(payments, reimbursements);
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">HDFC Credila loan</h1>
        <Badge tone="warn">Planner, ledgers &amp; projections arrive in Phase 6</Badge>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <Stat label="Paid to lender" value={formatINR(totals.totalPaidMinor)} hint={`${formatINR(totals.byPayer.krish)} by me · ${formatINR(totals.byPayer.sister)} by sister`} />
        </Card>
        <Card>
          <Stat label="Owed to sister" value={formatINR(sister.owedMinor)} hint={`Funded ${formatINR(sister.fundedMinor)} · reimbursed ${formatINR(sister.reimbursedMinor)}`} />
        </Card>
        <Card>
          <Stat label="Planned (not paid)" value={formatINR(totals.plannedMinor)} hint={`${totals.bouncedCount} bounced payment kept for audit, excluded`} />
        </Card>
      </div>
    </div>
  );
}
