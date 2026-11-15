/**
 * One-time seed of Krish's real starting data (no sample/fake data). Idempotent: every insert
 * is keyed by a unique constraint or a deterministic seed key and uses ON CONFLICT DO NOTHING,
 * so re-running never duplicates or overwrites anything edited since. Runs in one transaction.
 */
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { DecisionSpec } from "@/engines/decisions";
import {
  CATEGORY,
  CONFIRMED_SPLITWISE_MAP,
  DEFAULT_BUDGETS,
  DEFAULT_GROCERY_KEYWORDS,
  DEFAULT_LARGE_EXPENSE_THRESHOLD_MINOR,
  DEFAULT_PHONE_BILL_KEYWORDS,
  DEFAULT_RECURRING,
  DEFAULT_SUBSCRIPTION_KEYWORDS,
  SUGGESTED_SPLITWISE_MAP,
} from "@/engines/defaults";
import { LOAN_FACTS, SEED_LENDER_PAYMENTS, SEED_PLANNED_PAYMENTS, SEED_REIMBURSEMENTS } from "@/engines/loan/seed";
import { PRESEEDED_DECISION_SPECS } from "@/engines/pipeline";
import * as schema from "./db/schema";
import { normalizeEmail } from "./owner-core";

type AnyDb = NodePgDatabase<typeof schema>;

export const BUDGET_DEFAULTS_FROM = "2025-01";
/** Custom categories used by suggested mappings (no default budget). */
export const SEED_CUSTOM_CATEGORIES = [CATEGORY.Travel];

export interface SeedOptions {
  ownerEmail: string;
  /** Krish-confirmed per-expense decisions from fixtures/private/confirmed-decisions.json. */
  localDecisions?: DecisionSpec[];
}

export type SeedReport = Record<string, { inserted: number; total: number }>;

export async function seed(db: AnyDb, opts: SeedOptions): Promise<SeedReport> {
  const email = normalizeEmail(opts.ownerEmail);
  return db.transaction(async (tx) => {
    const report: SeedReport = {};
    const note = (name: string, inserted: number, total: number) => (report[name] = { inserted, total });

    // owner
    const ownerIns = await tx
      .insert(schema.owners)
      .values({ email, settings: { largeExpenseThresholdMinor: DEFAULT_LARGE_EXPENSE_THRESHOLD_MINOR } })
      .onConflictDoNothing({ target: schema.owners.email })
      .returning({ id: schema.owners.id });
    const [owner] = await tx.select().from(schema.owners).where(eq(schema.owners.email, email));
    if (!owner) throw new Error("owner row missing after insert");
    note("owner", ownerIns.length, 1);
    const ownerId = owner.id;

    // categories
    const catValues = [
      ...DEFAULT_BUDGETS.map((b, i) => ({ ownerId, name: b.name, kind: "builtin" as const, sortOrder: i })),
      ...SEED_CUSTOM_CATEGORIES.map((name, i) => ({ ownerId, name, kind: "custom" as const, sortOrder: 100 + i })),
    ];
    const catIns = await tx.insert(schema.categories).values(catValues).onConflictDoNothing().returning({ id: schema.categories.id });
    note("categories", catIns.length, catValues.length);
    const cats = await tx.select().from(schema.categories).where(eq(schema.categories.ownerId, ownerId));
    const catId = (name: string) => {
      const c = cats.find((x) => x.name === name);
      if (!c) throw new Error(`Seed: category "${name}" missing`);
      return c.id;
    };

    // budget defaults
    const budgetValues = DEFAULT_BUDGETS.map((b) => ({ ownerId, categoryId: catId(b.name), amountMinor: b.budgetMinor, effectiveFrom: BUDGET_DEFAULTS_FROM }));
    const budIns = await tx.insert(schema.budgetDefaults).values(budgetValues).onConflictDoNothing().returning({ id: schema.budgetDefaults.id });
    note("budgetDefaults", budIns.length, budgetValues.length);

    // Splitwise category maps
    const mapValues = [
      ...Object.entries(CONFIRMED_SPLITWISE_MAP).map(([sw, app]) => ({ ownerId, splitwiseName: sw, categoryId: catId(app), status: "confirmed" as const })),
      ...Object.entries(SUGGESTED_SPLITWISE_MAP).map(([sw, app]) => ({ ownerId, splitwiseName: sw, categoryId: catId(app), status: "suggested" as const })),
    ];
    const mapIns = await tx.insert(schema.splitwiseCategoryMaps).values(mapValues).onConflictDoNothing().returning({ id: schema.splitwiseCategoryMaps.id });
    note("categoryMaps", mapIns.length, mapValues.length);

    // keyword rules
    const kwValues = [
      ...DEFAULT_GROCERY_KEYWORDS.map((keyword) => ({ ownerId, kind: "grocery" as const, keyword })),
      ...DEFAULT_PHONE_BILL_KEYWORDS.map((keyword) => ({ ownerId, kind: "phone_bill" as const, keyword })),
      ...DEFAULT_SUBSCRIPTION_KEYWORDS.map((keyword) => ({ ownerId, kind: "subscription" as const, keyword })),
    ];
    const kwIns = await tx.insert(schema.keywordRules).values(kwValues).onConflictDoNothing().returning({ id: schema.keywordRules.id });
    note("keywordRules", kwIns.length, kwValues.length);

    // recurring rules
    const recValues = DEFAULT_RECURRING.map((r) => ({
      ownerId,
      series: r.name.toLowerCase(),
      name: r.name,
      categoryId: catId(r.category),
      amountMinor: r.amountMinor,
      effectiveFrom: r.effectiveFrom,
      dayOfMonth: r.dayOfMonth,
    }));
    const recIns = await tx.insert(schema.recurringRules).values(recValues).onConflictDoNothing().returning({ id: schema.recurringRules.id });
    note("recurringRules", recIns.length, recValues.length);

    // Not-an-expense decisions: pending until the first sync pins them to an expense
    const decisionValues = [
      ...PRESEEDED_DECISION_SPECS.map((d) => ({ d, origin: "preseed" as const })),
      ...(opts.localDecisions ?? []).map((d) => ({ d, origin: "local" as const })),
    ].map(({ d, origin }) => ({
      ownerId,
      specId: d.id,
      matchSpec: { date: d.date, description: d.description, costMinor: d.costMinor, group: d.group ?? null },
      reason: d.reason,
      state: "pending" as const,
      origin,
    }));
    const decIns = decisionValues.length
      ? await tx
          .insert(schema.expenseDecisions)
          .values(decisionValues)
          .onConflictDoNothing({ target: [schema.expenseDecisions.ownerId, schema.expenseDecisions.specId] })
          .returning({ id: schema.expenseDecisions.id })
      : [];
    note("decisions", decIns.length, decisionValues.length);

    // loan
    const loanIns = await tx
      .insert(schema.loans)
      .values({ ownerId, lender: LOAN_FACTS.lender, currency: "INR", sanctionedMinor: LOAN_FACTS.sanctionedMinor, provenance: LOAN_FACTS.sanctionedProvenance, seedKey: "credila" })
      .onConflictDoNothing()
      .returning({ id: schema.loans.id });
    note("loan", loanIns.length, 1);
    const [loan] = await tx.select().from(schema.loans).where(and(eq(schema.loans.ownerId, ownerId), eq(schema.loans.seedKey, "credila")));
    if (!loan) throw new Error("loan row missing after insert");
    const loanId = loan.id;

    const rateIns = await tx
      .insert(schema.loanRates)
      .values({ ownerId, loanId, effectiveFrom: LOAN_FACTS.rate.effectiveFrom, annualPercent: LOAN_FACTS.rate.annualPercent, provenance: LOAN_FACTS.rate.provenance, note: LOAN_FACTS.rate.note })
      .onConflictDoNothing()
      .returning({ id: schema.loanRates.id });
    note("loanRates", rateIns.length, 1);

    const disbValues = LOAN_FACTS.disbursements.map((d, i) => ({ ownerId, loanId, date: d.date, amountMinor: d.amountMinor, note: d.note, provenance: d.provenance, seedKey: `disb-${i + 1}` }));
    const disbIns = await tx.insert(schema.loanDisbursements).values(disbValues).onConflictDoNothing().returning({ id: schema.loanDisbursements.id });
    note("disbursements", disbIns.length, disbValues.length);

    const s = LOAN_FACTS.schedule;
    const schedIns = await tx
      .insert(schema.loanSchedules)
      .values({
        ownerId,
        loanId,
        issuedOn: s.issuedOn,
        openingBalanceMinor: s.openingBalanceMinor,
        asOf: s.asOf,
        paymentDay: s.paymentDay,
        phases: s.phases.map((p) => ({ ...p })),
        partialInterestThrough: s.partialInterestThrough,
        finalPaymentMonth: s.finalPaymentMonth,
        provenance: s.provenance,
      })
      .onConflictDoNothing()
      .returning({ id: schema.loanSchedules.id });
    note("schedule", schedIns.length, 1);

    const payValues = [...SEED_LENDER_PAYMENTS, ...SEED_PLANNED_PAYMENTS].map((p) => ({
      ownerId,
      loanId,
      dueDate: p.dueDate,
      paidDate: p.paidDate,
      amountMinor: p.amountMinor,
      payer: p.payer,
      type: p.type,
      status: p.status,
      reference: p.reference ?? null,
      note: p.note ?? null,
      idempotencyKey: `seed:${p.id}`,
    }));
    const payIns = await tx.insert(schema.lenderPayments).values(payValues).onConflictDoNothing().returning({ id: schema.lenderPayments.id });
    note("lenderPayments", payIns.length, payValues.length);

    const reimbValues = SEED_REIMBURSEMENTS.map((r) => ({ ownerId, loanId, date: r.date, amountMinor: r.amountMinor, kind: r.kind, note: r.note ?? null, idempotencyKey: `seed:${r.id}` }));
    const reimbIns = await tx.insert(schema.sisterReimbursements).values(reimbValues).onConflictDoNothing().returning({ id: schema.sisterReimbursements.id });
    note("reimbursements", reimbIns.length, reimbValues.length);

    return report;
  });
}
