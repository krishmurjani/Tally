/**
 * One-off data update from the lender's own documents (portal screens, sanction letter, loan agreement,
 * transaction history, repayment schedule issued 2026-11-16). Idempotent: safe to run twice.
 *
 *  - rate history: the six Credila rate changes replace the single "stated by Krish" 11.55%
 *  - repayment schedule: a new row with the outstanding after the 2026-11-11 instalment, the roll-up split,
 *    the 174-instalment tenure and the true final payment (Jan 2039)
 *  - interest allocation on each paid pre-EMI instalment (it was all interest, per the schedule)
 *  - the saved planner scenario's rate follows the current 11.8%
 *
 * Usage (back up first):  pnpm backup && pnpm exec tsx --env-file=.env.local scripts/apply-credila-update.ts
 */
import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { LOAN_FACTS } from "../src/engines/loan/seed";
import { connect } from "../src/server/db/connect";
import { ownerEmailFromEnv, resolveOwner } from "../src/server/owner-core";
import * as schema from "../src/server/db/schema";

const { db, pool } = connect();
try {
  const owner = await resolveOwner({ user: { email: ownerEmailFromEnv() } }, db);
  await db.transaction(async (tx) => {
    const [loan] = await tx.select().from(schema.loans).where(eq(schema.loans.ownerId, owner.id));
    if (!loan) throw new Error("No loan row");
    const out: string[] = [];

    // Loan: the sanctioned amount is on the lender's own sanction letter and portal.
    await tx.update(schema.loans).set({ provenance: LOAN_FACTS.sanctionedProvenance, updatedAt: new Date() }).where(eq(schema.loans.id, loan.id));

    // Rates: drop the single stated rate, add the lender's history.
    const del = await tx
      .delete(schema.loanRates)
      .where(and(eq(schema.loanRates.loanId, loan.id), eq(schema.loanRates.effectiveFrom, "2024-07-30"), eq(schema.loanRates.provenance, "stated by Krish")))
      .returning({ id: schema.loanRates.id });
    const rates = await tx
      .insert(schema.loanRates)
      .values(LOAN_FACTS.rates.map((r) => ({ ownerId: owner.id, loanId: loan.id, effectiveFrom: r.effectiveFrom, annualPercent: r.annualPercent, provenance: r.provenance, note: r.note })))
      .onConflictDoNothing()
      .returning({ id: schema.loanRates.id });
    for (const r of LOAN_FACTS.rates) {
      await tx.update(schema.loanRates).set({ note: r.note, provenance: r.provenance }).where(and(eq(schema.loanRates.loanId, loan.id), eq(schema.loanRates.effectiveFrom, r.effectiveFrom)));
    }
    out.push(`rates: removed ${del.length} stated, added ${rates.length}`);

    // Schedule: the 2026-11-16 statement (the planner reads the latest by issue date).
    const s = LOAN_FACTS.schedule;
    const sched = await tx
      .insert(schema.loanSchedules)
      .values({
        ownerId: owner.id,
        loanId: loan.id,
        issuedOn: s.issuedOn,
        openingBalanceMinor: s.openingBalanceMinor,
        asOf: s.asOf,
        paymentDay: s.paymentDay,
        phases: s.phases.map((p) => ({ ...p })),
        partialInterestThrough: s.partialInterestThrough,
        finalPaymentMonth: s.finalPaymentMonth,
        principalAtRollupMinor: s.principalAtRollupMinor,
        rollupThrough: s.rollupThrough,
        tenureMonths: s.tenureMonths,
        provenance: s.provenance,
      })
      .onConflictDoNothing()
      .returning({ id: schema.loanSchedules.id });
    out.push(`schedule: added ${sched.length}`);

    // Allocation: every paid pre-EMI instalment from 2024-08-11 to 2026-11-11 was entirely interest.
    // The three 2025-12-16 payments (₹9,533 against a ₹9,033 instalment) include ₹500 of something else: left alone.
    const rows = await tx
      .select()
      .from(schema.lenderPayments)
      .where(
        and(
          eq(schema.lenderPayments.loanId, loan.id),
          eq(schema.lenderPayments.status, "paid"),
          inArray(schema.lenderPayments.type, ["pmii_emi", "repayment"]),
          gte(schema.lenderPayments.dueDate, "2024-08-11"),
          lte(schema.lenderPayments.dueDate, "2026-11-11"),
          isNull(schema.lenderPayments.interestMinor),
          isNull(schema.lenderPayments.deletedAt),
        ),
      );
    let allocated = 0;
    for (const p of rows) {
      if (p.paidDate === "2025-12-16") continue;
      await tx
        .update(schema.lenderPayments)
        .set({ interestMinor: p.amountMinor, principalMinor: 0, version: p.version + 1, updatedAt: new Date() })
        .where(and(eq(schema.lenderPayments.id, p.id), eq(schema.lenderPayments.version, p.version)));
      allocated++;
    }
    out.push(`allocations: ${allocated} payments marked all-interest`);

    // The saved plan follows the current rate.
    const [sc] = await tx.select().from(schema.payoffScenarios).where(and(eq(schema.payoffScenarios.loanId, loan.id), eq(schema.payoffScenarios.name, "My plan")));
    const saved = (sc?.inputs ?? null) as { annualRatePercent?: string } | null;
    if (sc && saved && saved.annualRatePercent !== LOAN_FACTS.rate.annualPercent) {
      await tx
        .update(schema.payoffScenarios)
        .set({ inputs: { ...saved, annualRatePercent: LOAN_FACTS.rate.annualPercent }, version: sc.version + 1, updatedAt: new Date() })
        .where(and(eq(schema.payoffScenarios.id, sc.id), eq(schema.payoffScenarios.version, sc.version)));
      out.push(`scenario: rate ${saved.annualRatePercent}% → ${LOAN_FACTS.rate.annualPercent}%`);
    }
    console.log(out.join("\n"));
  });
  console.log(`Done (${new URL(process.env.DATABASE_URL!).host.replace(/^[^.]*/, "***")}).`);
} finally {
  await pool.end();
}
