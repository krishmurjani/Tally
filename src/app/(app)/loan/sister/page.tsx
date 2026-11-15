import type { Metadata } from "next";
import { sisterLedger } from "@/engines/loan/sister";
import { formatINR } from "@/engines/money";
import { Card, Stat } from "@/components/ui";
import { requireOwnerOrRedirect } from "@/server/auth-guard";
import { getDb } from "@/server/db/client";
import { loadLoanLedgers } from "@/server/repos/loan";
import { Reimbursements } from "./reimbursements";

export const metadata: Metadata = { title: "Sister reimbursements" };

export default async function SisterPage() {
  const owner = await requireOwnerOrRedirect();
  const { payments, reimbursements } = await loadLoanLedgers(getDb(), owner);
  const l = sisterLedger(payments, reimbursements);
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">Paying my sister back never reduces the loan — this ledger is separate from lender payments.</p>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <Stat label="She paid the lender" value={formatINR(l.fundedMinor)} hint="Paid lender payments with payer Sister (bounce excluded)" />
        </Card>
        <Card>
          <Stat label="I've reimbursed" value={formatINR(l.reimbursedMinor)} />
        </Card>
        <Card>
          <Stat label={l.creditMinor > 0 ? "I've overpaid her by" : "I owe her"} value={formatINR(l.creditMinor > 0 ? l.creditMinor : l.owedMinor)} />
        </Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Not yet reimbursed · ${l.unreimbursed.length}`}>
          {l.unreimbursed.length === 0 ? (
            <p className="text-sm text-forest-700">Everything she paid has been reimbursed.</p>
          ) : (
            <ul className="divide-y divide-line/70 text-sm">
              {l.unreimbursed.map((u) => (
                <li key={u.payment.id} className="flex justify-between py-1.5">
                  <span>{u.payment.paidDate ?? u.payment.dueDate}</span>
                  <span className="tabular-nums">
                    {formatINR(u.remainingMinor)}
                    {u.remainingMinor !== u.payment.amountMinor && <span className="text-muted"> of {formatINR(u.payment.amountMinor)}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-faint">Reimbursements are applied to her oldest payments first.</p>
        </Card>
        <Card title="Reimbursements">
          <Reimbursements entries={reimbursements} />
        </Card>
      </div>
    </div>
  );
}
