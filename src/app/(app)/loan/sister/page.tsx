import type { Metadata } from "next";
import { sisterLedger } from "@/engines/loan/sister";
import { formatINR } from "@/engines/money";
import { Hero, HeroLabel, HeroNumber, HeroStats } from "@/components/hero";
import { Card } from "@/components/ui";
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
      <Hero>
        <HeroLabel>{l.creditMinor > 0 ? "I've overpaid her by" : "I owe her"}</HeroLabel>
        <HeroNumber>{formatINR(l.creditMinor > 0 ? l.creditMinor : l.owedMinor, { decimals: "never" })}</HeroNumber>
        <HeroStats
          items={[
            { label: "She paid the lender", value: formatINR(l.fundedMinor), hint: "Lender payments with payer Sister (bounces excluded)" },
            { label: "I've reimbursed", value: formatINR(l.reimbursedMinor) },
          ]}
        />
      </Hero>

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
