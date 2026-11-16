import type { Metadata } from "next";
import { paidTotals } from "@/engines/loan/ledger";
import { formatINR } from "@/engines/money";
import { Hero, HeroLabel, HeroNumber, HeroStats } from "@/components/hero";
import { Card } from "@/components/ui";
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
      <Hero>
        <HeroLabel>Paid to the lender so far</HeroLabel>
        <HeroNumber>{formatINR(t.totalPaidMinor, { decimals: "never" })}</HeroNumber>
        <HeroStats
          items={[
            { label: "Paid by me", value: formatINR(t.byPayer.krish) },
            { label: "Paid by sister", value: formatINR(t.byPayer.sister) },
            { label: "Planned (not paid)", value: formatINR(t.plannedMinor) },
            { label: "Bounced", value: String(t.bouncedCount), hint: "Kept for audit, excluded from totals" },
          ]}
        />
      </Hero>
      <Card title="Lender payment ledger">
        <PaymentsTable payments={payments} />
      </Card>
    </div>
  );
}
