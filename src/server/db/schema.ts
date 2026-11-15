/**
 * Database schema. Conventions:
 * - Money: bigint minor units (cents / paise) + explicit currency. Never floats.
 * - Accounting dates: `date` (string mode, YYYY-MM-DD); months: text YYYY-MM.
 * - Every row belongs to an owner (owner_id). Editable rows carry `version` for optimistic concurrency.
 * - Manual creates carry an idempotency key, unique per owner, so retries never duplicate.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const money = (name: string) => bigint(name, { mode: "number" });
const day = (name: string) => date(name, { mode: "string" });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

const id = () => uuid("id").primaryKey().defaultRandom();
const created = () => ts("created_at").notNull().defaultNow();
const updated = () => ts("updated_at").notNull().defaultNow();
const version = () => integer("version").notNull().default(1);
const monthCheck = (col: string) => sql.raw(`${col} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`);

export const owners = pgTable("owners", {
  id: id(),
  email: text("email").notNull().unique(),
  splitwiseUserId: bigint("splitwise_user_id", { mode: "number" }),
  /** { largeExpenseThresholdMinor: number } */
  settings: jsonb("settings").$type<{ largeExpenseThresholdMinor: number }>().notNull(),
  createdAt: created(),
  updatedAt: updated(),
  version: version(),
});

const ownerId = () =>
  uuid("owner_id")
    .notNull()
    .references(() => owners.id, { onDelete: "cascade" });

export const categories = pgTable(
  "categories",
  {
    id: id(),
    ownerId: ownerId(),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["builtin", "custom"] }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    archived: boolean("archived").notNull().default(false),
    createdAt: created(),
    updatedAt: updated(),
    version: version(),
  },
  (t) => [uniqueIndex("categories_owner_name").on(t.ownerId, t.name), check("categories_kind", sql`${t.kind} in ('builtin','custom')`)],
);

const categoryRef = (name = "category_id") => uuid(name).references(() => categories.id, { onDelete: "restrict" });

/** Default budget per category, effective from a month. Changing a default never rewrites month_budgets. */
export const budgetDefaults = pgTable(
  "budget_defaults",
  {
    id: id(),
    ownerId: ownerId(),
    categoryId: categoryRef().notNull(),
    amountMinor: money("amount_minor").notNull(),
    effectiveFrom: text("effective_from").notNull(),
    createdAt: created(),
    updatedAt: updated(),
    version: version(),
  },
  (t) => [
    uniqueIndex("budget_defaults_unique").on(t.ownerId, t.categoryId, t.effectiveFrom),
    check("budget_defaults_month", monthCheck("effective_from")),
    check("budget_defaults_nonneg", sql`${t.amountMinor} >= 0`),
  ],
);

/** A month's budget snapshot. */
export const monthBudgets = pgTable(
  "month_budgets",
  {
    id: id(),
    ownerId: ownerId(),
    month: text("month").notNull(),
    categoryId: categoryRef().notNull(),
    amountMinor: money("amount_minor").notNull(),
    createdAt: created(),
    updatedAt: updated(),
    version: version(),
  },
  (t) => [
    uniqueIndex("month_budgets_unique").on(t.ownerId, t.month, t.categoryId),
    check("month_budgets_month", monthCheck("month")),
    check("month_budgets_nonneg", sql`${t.amountMinor} >= 0`),
  ],
);

export const splitwiseCategoryMaps = pgTable(
  "splitwise_category_maps",
  {
    id: id(),
    ownerId: ownerId(),
    splitwiseName: text("splitwise_name").notNull(),
    categoryId: categoryRef(),
    status: text("status", { enum: ["confirmed", "suggested"] }).notNull(),
    createdAt: created(),
    updatedAt: updated(),
    version: version(),
  },
  (t) => [
    uniqueIndex("sw_category_maps_unique").on(t.ownerId, t.splitwiseName),
    check("sw_category_maps_status", sql`${t.status} in ('confirmed','suggested')`),
  ],
);

export const keywordRules = pgTable(
  "keyword_rules",
  {
    id: id(),
    ownerId: ownerId(),
    kind: text("kind", { enum: ["grocery", "phone_bill", "subscription"] }).notNull(),
    keyword: text("keyword").notNull(),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex("keyword_rules_unique").on(t.ownerId, t.kind, t.keyword),
    check("keyword_rules_kind", sql`${t.kind} in ('grocery','phone_bill','subscription')`),
  ],
);

const rowStatus = (name = "status") => text(name, { enum: ["included", "excluded", "review"] });

export const syncRuns = pgTable("sync_runs", {
  id: id(),
  ownerId: ownerId(),
  kind: text("kind", { enum: ["month", "changes"] }).notNull(),
  rangeFrom: day("range_from"),
  rangeTo: day("range_to"),
  updatedAfter: ts("updated_after"),
  startedAt: created(),
  finishedAt: ts("finished_at"),
  counts: jsonb("counts").$type<Record<string, number>>(),
  error: text("error"),
});

/** One row per Splitwise expense: raw API JSON (audit) + fields derived from it on every sync. */
export const splitwiseExpenses = pgTable(
  "splitwise_expenses",
  {
    id: id(),
    ownerId: ownerId(),
    splitwiseId: bigint("splitwise_id", { mode: "number" }).notNull(),
    raw: jsonb("raw").notNull(),
    rawHash: text("raw_hash").notNull(),
    swUpdatedAt: ts("sw_updated_at"),
    swDeletedAt: ts("sw_deleted_at"),
    lastSeenSyncId: uuid("last_seen_sync_id").references(() => syncRuns.id, { onDelete: "set null" }),
    missingSince: ts("missing_since"),
    // derived
    accountingDate: day("accounting_date").notNull(),
    month: text("month").notNull(),
    description: text("description").notNull(),
    costMinor: money("cost_minor").notNull(),
    currency: text("currency").notNull(),
    myOwedMinor: money("my_owed_minor"),
    myPaidMinor: money("my_paid_minor"),
    groupId: bigint("group_id", { mode: "number" }),
    groupName: text("group_name"),
    swCategory: text("sw_category"),
    status: rowStatus().notNull(),
    reason: text("reason").notNull(),
    reasonText: text("reason_text").notNull(),
    shareMinor: money("share_minor").notNull(),
    derivation: jsonb("derivation").$type<string[]>().notNull(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    uniqueIndex("splitwise_expenses_owner_sw").on(t.ownerId, t.splitwiseId),
    index("splitwise_expenses_owner_month").on(t.ownerId, t.month),
    check("splitwise_expenses_month", monthCheck("month")),
  ],
);

export const csvImports = pgTable(
  "csv_imports",
  {
    id: id(),
    ownerId: ownerId(),
    fileName: text("file_name").notNull(),
    source: text("source").notNull(),
    exportDate: day("export_date"),
    sha256: text("sha256").notNull(),
    rowCount: integer("row_count").notNull(),
    /** The file's text. Rows are derived at read time, because pairwise combination spans files. */
    content: text("content").notNull(),
    importedAt: created(),
  },
  (t) => [uniqueIndex("csv_imports_owner_sha").on(t.ownerId, t.sha256)],
);

/** "Not an expense" decisions. Per expense only — no keyword rules exist. */
export const expenseDecisions = pgTable(
  "expense_decisions",
  {
    id: id(),
    ownerId: ownerId(),
    /** Stable key of the decided row ("sw:<id>" or a CSV row key). Null while pending. */
    rowKey: text("row_key"),
    /** For pre-seeded decisions: { date, description, costMinor, group }. */
    matchSpec: jsonb("match_spec").$type<{ date: string; description: string; costMinor: number; group?: string | null }>(),
    specId: text("spec_id"),
    reason: text("reason"),
    state: text("state", { enum: ["pending", "pinned", "revoked"] }).notNull(),
    origin: text("origin", { enum: ["preseed", "local", "manual"] }).notNull(),
    idempotencyKey: text("idempotency_key"),
    createdAt: created(),
    updatedAt: updated(),
    version: version(),
  },
  (t) => [
    uniqueIndex("expense_decisions_active_row")
      .on(t.ownerId, t.rowKey)
      .where(sql`${t.state} = 'pinned'`),
    uniqueIndex("expense_decisions_spec").on(t.ownerId, t.specId),
    uniqueIndex("expense_decisions_idem").on(t.ownerId, t.idempotencyKey),
    check("expense_decisions_state", sql`${t.state} in ('pending','pinned','revoked')`),
    check("expense_decisions_pinned_has_row", sql`${t.state} <> 'pinned' or ${t.rowKey} is not null`),
  ],
);

export const categoryOverrides = pgTable(
  "category_overrides",
  {
    id: id(),
    ownerId: ownerId(),
    rowKey: text("row_key").notNull(),
    categoryId: categoryRef().notNull(),
    createdAt: created(),
    updatedAt: updated(),
    version: version(),
  },
  (t) => [uniqueIndex("category_overrides_unique").on(t.ownerId, t.rowKey)],
);

/** "Seen, this is expected": hides the Large flag on one row. Per row only — never a keyword rule. */
export const flagDismissals = pgTable(
  "flag_dismissals",
  {
    id: id(),
    ownerId: ownerId(),
    rowKey: text("row_key").notNull(),
    flag: text("flag", { enum: ["large"] }).notNull().default("large"),
    createdAt: created(),
  },
  (t) => [uniqueIndex("flag_dismissals_unique").on(t.ownerId, t.rowKey, t.flag)],
);

export const usdConfirmations = pgTable(
  "usd_confirmations",
  {
    id: id(),
    ownerId: ownerId(),
    splitwiseId: bigint("splitwise_id", { mode: "number" }).notNull(),
    usdMinor: money("usd_minor").notNull(),
    note: text("note"),
    createdAt: created(),
    updatedAt: updated(),
    version: version(),
  },
  (t) => [uniqueIndex("usd_confirmations_unique").on(t.ownerId, t.splitwiseId)],
);

export const manualExpenses = pgTable(
  "manual_expenses",
  {
    id: id(),
    ownerId: ownerId(),
    date: day("date").notNull(),
    month: text("month").notNull(),
    description: text("description").notNull(),
    categoryId: categoryRef().notNull(),
    /** Signed: refunds are allowed deliberately. */
    amountMinor: money("amount_minor").notNull(),
    currency: text("currency").notNull().default("USD"),
    note: text("note"),
    idempotencyKey: text("idempotency_key").notNull(),
    deletedAt: ts("deleted_at"),
    createdAt: created(),
    updatedAt: updated(),
    version: version(),
  },
  (t) => [
    uniqueIndex("manual_expenses_idem").on(t.ownerId, t.idempotencyKey),
    index("manual_expenses_owner_month").on(t.ownerId, t.month),
    check("manual_expenses_month", sql`${t.month} = to_char(${t.date}, 'YYYY-MM')`),
    check("manual_expenses_usd", sql`${t.currency} = 'USD'`),
  ],
);

export const recurringRules = pgTable(
  "recurring_rules",
  {
    id: id(),
    ownerId: ownerId(),
    series: text("series").notNull(),
    name: text("name").notNull(),
    categoryId: categoryRef().notNull(),
    amountMinor: money("amount_minor").notNull(),
    effectiveFrom: text("effective_from").notNull(),
    effectiveTo: text("effective_to"),
    dayOfMonth: integer("day_of_month").notNull().default(1),
    createdAt: created(),
    updatedAt: updated(),
    version: version(),
  },
  (t) => [
    uniqueIndex("recurring_rules_unique").on(t.ownerId, t.series, t.effectiveFrom),
    check("recurring_rules_from", monthCheck("effective_from")),
    check("recurring_rules_day", sql`${t.dayOfMonth} between 1 and 31`),
  ],
);

export const recurringOverrides = pgTable(
  "recurring_overrides",
  {
    id: id(),
    ownerId: ownerId(),
    series: text("series").notNull(),
    month: text("month").notNull(),
    /** null = skip this month */
    amountMinor: money("amount_minor"),
    note: text("note"),
    createdAt: created(),
    updatedAt: updated(),
    version: version(),
  },
  (t) => [uniqueIndex("recurring_overrides_unique").on(t.ownerId, t.series, t.month), check("recurring_overrides_month", monthCheck("month"))],
);

export const months = pgTable(
  "months",
  {
    id: id(),
    ownerId: ownerId(),
    month: text("month").notNull(),
    status: text("status", { enum: ["open", "closed"] }).notNull().default("open"),
    dataSource: text("data_source", { enum: ["api", "csv"] }),
    closedAt: ts("closed_at"),
    snapshot: jsonb("snapshot"),
    snapshotHash: text("snapshot_hash"),
    pendingChanges: jsonb("pending_changes"),
    /** Hash of a change-diff Krish chose to ignore ("keep snapshot"), so it isn't re-flagged. */
    keptDiffHash: text("kept_diff_hash"),
    createdAt: created(),
    updatedAt: updated(),
    version: version(),
  },
  (t) => [
    uniqueIndex("months_unique").on(t.ownerId, t.month),
    check("months_month", monthCheck("month")),
    check("months_closed_has_snapshot", sql`${t.status} <> 'closed' or ${t.snapshot} is not null`),
  ],
);

export const incomeEntries = pgTable(
  "income_entries",
  {
    id: id(),
    ownerId: ownerId(),
    date: day("date").notNull(),
    amountMinor: money("amount_minor").notNull(),
    currency: text("currency").notNull().default("USD"),
    /** Where the money came from. For "employer" the name is stored in `employer`. */
    sourceType: text("source_type", { enum: ["employer", "cash", "gift_family", "gift_card", "other"] }).notNull().default("employer"),
    employer: text("employer"),
    note: text("note"),
    idempotencyKey: text("idempotency_key").notNull(),
    deletedAt: ts("deleted_at"),
    createdAt: created(),
    updatedAt: updated(),
    version: version(),
  },
  (t) => [
    uniqueIndex("income_entries_idem").on(t.ownerId, t.idempotencyKey),
    index("income_entries_owner_date").on(t.ownerId, t.date),
    check("income_entries_nonneg", sql`${t.amountMinor} >= 0`),
  ],
);

/** Historical monthly category summaries (no fake transactions). Ignored once a month has detailed data. */
export const historySummaries = pgTable(
  "history_summaries",
  {
    id: id(),
    ownerId: ownerId(),
    month: text("month").notNull(),
    categoryId: categoryRef().notNull(),
    amountMinor: money("amount_minor").notNull(),
    importBatch: uuid("import_batch").notNull(),
    createdAt: created(),
    updatedAt: updated(),
    version: version(),
  },
  (t) => [uniqueIndex("history_summaries_unique").on(t.ownerId, t.month, t.categoryId), check("history_summaries_month", monthCheck("month"))],
);

// ---------------------------------------------------------------- loan (INR paise)

export const loans = pgTable("loans", {
  id: id(),
  ownerId: ownerId(),
  lender: text("lender").notNull(),
  currency: text("currency").notNull().default("INR"),
  sanctionedMinor: money("sanctioned_minor").notNull(),
  provenance: text("provenance").notNull(),
  seedKey: text("seed_key"),
  createdAt: created(),
  updatedAt: updated(),
  version: version(),
}, (t) => [uniqueIndex("loans_seed").on(t.ownerId, t.seedKey)]);

const loanRef = () =>
  uuid("loan_id")
    .notNull()
    .references(() => loans.id, { onDelete: "cascade" });

export const loanRates = pgTable(
  "loan_rates",
  {
    id: id(),
    ownerId: ownerId(),
    loanId: loanRef(),
    effectiveFrom: day("effective_from").notNull(),
    /** Decimal string, e.g. "11.55" (a rate, not money). */
    annualPercent: text("annual_percent").notNull(),
    provenance: text("provenance").notNull(),
    note: text("note"),
    createdAt: created(),
    version: version(),
  },
  (t) => [
    uniqueIndex("loan_rates_unique").on(t.loanId, t.effectiveFrom),
    check("loan_rates_decimal", sql`${t.annualPercent} ~ '^[0-9]+(\\.[0-9]+)?$'`),
  ],
);

export const loanDisbursements = pgTable(
  "loan_disbursements",
  {
    id: id(),
    ownerId: ownerId(),
    loanId: loanRef(),
    date: day("date").notNull(),
    amountMinor: money("amount_minor").notNull(),
    note: text("note"),
    provenance: text("provenance").notNull(),
    seedKey: text("seed_key"),
    createdAt: created(),
  },
  (t) => [uniqueIndex("loan_disbursements_seed").on(t.ownerId, t.seedKey)],
);

export const loanSchedules = pgTable(
  "loan_schedules",
  {
    id: id(),
    ownerId: ownerId(),
    loanId: loanRef(),
    issuedOn: day("issued_on").notNull(),
    openingBalanceMinor: money("opening_balance_minor").notNull(),
    asOf: day("as_of").notNull(),
    paymentDay: integer("payment_day").notNull(),
    phases: jsonb("phases").$type<{ from: string; kind: "partial_interest" | "emi"; paymentMinor: number; label?: string }[]>().notNull(),
    partialInterestThrough: text("partial_interest_through"),
    finalPaymentMonth: text("final_payment_month"),
    provenance: text("provenance").notNull(),
    createdAt: created(),
    version: version(),
  },
  (t) => [uniqueIndex("loan_schedules_unique").on(t.loanId, t.issuedOn)],
);

export const lenderPayments = pgTable(
  "lender_payments",
  {
    id: id(),
    ownerId: ownerId(),
    loanId: loanRef(),
    dueDate: day("due_date").notNull(),
    paidDate: day("paid_date"),
    amountMinor: money("amount_minor").notNull(),
    payer: text("payer", { enum: ["krish", "sister", "other"] }),
    type: text("type", { enum: ["pmii_emi", "repayment", "bounce"] }).notNull(),
    status: text("status", { enum: ["paid", "planned", "overdue", "bounced"] }).notNull(),
    reference: text("reference"),
    note: text("note"),
    /** Optional lender allocation. Without it a payment is never labelled "interest". */
    interestMinor: money("interest_minor"),
    principalMinor: money("principal_minor"),
    idempotencyKey: text("idempotency_key").notNull(),
    deletedAt: ts("deleted_at"),
    createdAt: created(),
    updatedAt: updated(),
    version: version(),
  },
  (t) => [
    uniqueIndex("lender_payments_idem").on(t.ownerId, t.idempotencyKey),
    check(
      "lender_payments_allocation",
      sql`(${t.interestMinor} is null and ${t.principalMinor} is null) or (${t.interestMinor} >= 0 and ${t.principalMinor} >= 0 and ${t.interestMinor} + ${t.principalMinor} = ${t.amountMinor})`,
    ),
    check("lender_payments_positive", sql`${t.amountMinor} > 0`),
    check("lender_payments_paid_date", sql`${t.status} <> 'paid' or ${t.paidDate} is not null`),
    check("lender_payments_bounce", sql`(${t.type} = 'bounce') = (${t.status} = 'bounced')`),
  ],
);

export const sisterReimbursements = pgTable(
  "sister_reimbursements",
  {
    id: id(),
    ownerId: ownerId(),
    loanId: loanRef(),
    date: day("date").notNull(),
    amountMinor: money("amount_minor").notNull(),
    kind: text("kind", { enum: ["opening", "entry"] }).notNull(),
    note: text("note"),
    idempotencyKey: text("idempotency_key").notNull(),
    deletedAt: ts("deleted_at"),
    createdAt: created(),
    updatedAt: updated(),
    version: version(),
  },
  (t) => [uniqueIndex("sister_reimbursements_idem").on(t.ownerId, t.idempotencyKey), check("sister_reimbursements_positive", sql`${t.amountMinor} > 0`)],
);

export const payoffScenarios = pgTable(
  "payoff_scenarios",
  {
    id: id(),
    ownerId: ownerId(),
    loanId: loanRef(),
    name: text("name").notNull().default("My plan"),
    inputs: jsonb("inputs").notNull(),
    linkedMonth: text("linked_month"),
    createdAt: created(),
    updatedAt: updated(),
    version: version(),
  },
  (t) => [uniqueIndex("payoff_scenarios_name").on(t.ownerId, t.loanId, t.name)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    ownerId: ownerId(),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    at: created(),
  },
  (t) => [index("audit_log_owner_entity").on(t.ownerId, t.entity, t.entityId)],
);
