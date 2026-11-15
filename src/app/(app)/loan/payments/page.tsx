import type { Metadata } from "next";
import { paidTotals } from "@/engines/loan/ledger";
import { formatINR } from "@/engines/money";
import { Card, Stat } from "@/components/ui";
import { requireOwnerOrRedirect } from "@/server/auth-guard";
import { getDb } from "@/server/db/client";
import { loadLoanLedgers } from "@/server/repos/loan";
import { PaymentsTable } from "./payments-table";

export const metadata: Metadata = { title: "Lender payments" };

export default async function PaymentsPage() {
  const owner = await requireOwnerOrRedirect();
  const { payments } = await loadLoanLedgers(getDb(), owner);
  const t = paidTotals(payments);
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <Stat label="Paid by me" value={formatINR(t.byPayer.krish)} />
        </Card>
        <Card>
          <Stat label="Paid by sister" value={formatINR(t.byPayer.sister)} />
        </Card>
        <Card>
          <Stat label="Planned (not paid)" value={formatINR(t.plannedMinor)} />
        </Card>
        <Card>
          <Stat label="Bounced" value={String(t.bouncedCount)} hint="Kept for audit, excluded from totals" />
        </Card>
      </div>
      <Card title="Lender payment ledger">
        <PaymentsTable payments={payments} />
      </Card>
    </div>
  );
}
