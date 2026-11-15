CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_defaults" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"effective_from" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "budget_defaults_month" CHECK (effective_from ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "budget_defaults_nonneg" CHECK ("budget_defaults"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "categories_kind" CHECK ("categories"."kind" in ('builtin','custom'))
);
--> statement-breakpoint
CREATE TABLE "category_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"row_key" text NOT NULL,
	"category_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "csv_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"source" text NOT NULL,
	"export_date" date,
	"sha256" text NOT NULL,
	"row_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "csv_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"import_id" uuid NOT NULL,
	"row_key" text NOT NULL,
	"month" text NOT NULL,
	"date" date NOT NULL,
	"description" text NOT NULL,
	"source_category" text,
	"group_label" text,
	"cost_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text NOT NULL,
	"reason" text NOT NULL,
	"reason_text" text NOT NULL,
	"share_minor" bigint NOT NULL,
	"derivation" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"row_key" text,
	"match_spec" jsonb,
	"spec_id" text,
	"reason" text,
	"state" text NOT NULL,
	"origin" text NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "expense_decisions_state" CHECK ("expense_decisions"."state" in ('pending','pinned','revoked')),
	CONSTRAINT "expense_decisions_pinned_has_row" CHECK ("expense_decisions"."state" <> 'pinned' or "expense_decisions"."row_key" is not null)
);
--> statement-breakpoint
CREATE TABLE "history_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"month" text NOT NULL,
	"category_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"import_batch" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "history_summaries_month" CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
CREATE TABLE "income_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"date" date NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"employer" text,
	"note" text,
	"idempotency_key" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "income_entries_nonneg" CHECK ("income_entries"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "keyword_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"keyword" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "keyword_rules_kind" CHECK ("keyword_rules"."kind" in ('grocery','phone_bill','subscription'))
);
--> statement-breakpoint
CREATE TABLE "lender_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"loan_id" uuid NOT NULL,
	"due_date" date NOT NULL,
	"paid_date" date,
	"amount_minor" bigint NOT NULL,
	"payer" text,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"reference" text,
	"note" text,
	"idempotency_key" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "lender_payments_positive" CHECK ("lender_payments"."amount_minor" > 0),
	CONSTRAINT "lender_payments_paid_date" CHECK ("lender_payments"."status" <> 'paid' or "lender_payments"."paid_date" is not null),
	CONSTRAINT "lender_payments_bounce" CHECK (("lender_payments"."type" = 'bounce') = ("lender_payments"."status" = 'bounced'))
);
--> statement-breakpoint
CREATE TABLE "loan_disbursements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"loan_id" uuid NOT NULL,
	"date" date NOT NULL,
	"amount_minor" bigint NOT NULL,
	"note" text,
	"provenance" text NOT NULL,
	"seed_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loan_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"loan_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"annual_percent" text NOT NULL,
	"provenance" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "loan_rates_decimal" CHECK ("loan_rates"."annual_percent" ~ '^[0-9]+(\.[0-9]+)?$')
);
--> statement-breakpoint
CREATE TABLE "loan_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"loan_id" uuid NOT NULL,
	"issued_on" date NOT NULL,
	"opening_balance_minor" bigint NOT NULL,
	"as_of" date NOT NULL,
	"payment_day" integer NOT NULL,
	"phases" jsonb NOT NULL,
	"partial_interest_through" text,
	"final_payment_month" text,
	"provenance" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"lender" text NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"sanctioned_minor" bigint NOT NULL,
	"provenance" text NOT NULL,
	"seed_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manual_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"date" date NOT NULL,
	"month" text NOT NULL,
	"description" text NOT NULL,
	"category_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"note" text,
	"idempotency_key" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "manual_expenses_month" CHECK ("manual_expenses"."month" = to_char("manual_expenses"."date", 'YYYY-MM')),
	CONSTRAINT "manual_expenses_usd" CHECK ("manual_expenses"."currency" = 'USD')
);
--> statement-breakpoint
CREATE TABLE "month_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"month" text NOT NULL,
	"category_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "month_budgets_month" CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "month_budgets_nonneg" CHECK ("month_budgets"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "months" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"month" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"data_source" text,
	"closed_at" timestamp with time zone,
	"snapshot" jsonb,
	"snapshot_hash" text,
	"pending_changes" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "months_month" CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "months_closed_has_snapshot" CHECK ("months"."status" <> 'closed' or "months"."snapshot" is not null)
);
--> statement-breakpoint
CREATE TABLE "owners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"splitwise_user_id" bigint,
	"settings" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "owners_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "payoff_scenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"loan_id" uuid NOT NULL,
	"name" text DEFAULT 'My plan' NOT NULL,
	"inputs" jsonb NOT NULL,
	"linked_month" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"series" text NOT NULL,
	"month" text NOT NULL,
	"amount_minor" bigint,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "recurring_overrides_month" CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
CREATE TABLE "recurring_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"series" text NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"effective_from" text NOT NULL,
	"effective_to" text,
	"day_of_month" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "recurring_rules_from" CHECK (effective_from ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "recurring_rules_day" CHECK ("recurring_rules"."day_of_month" between 1 and 31)
);
--> statement-breakpoint
CREATE TABLE "sister_reimbursements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"loan_id" uuid NOT NULL,
	"date" date NOT NULL,
	"amount_minor" bigint NOT NULL,
	"kind" text NOT NULL,
	"note" text,
	"idempotency_key" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "sister_reimbursements_positive" CHECK ("sister_reimbursements"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "splitwise_category_maps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"splitwise_name" text NOT NULL,
	"category_id" uuid,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "sw_category_maps_status" CHECK ("splitwise_category_maps"."status" in ('confirmed','suggested'))
);
--> statement-breakpoint
CREATE TABLE "splitwise_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"splitwise_id" bigint NOT NULL,
	"raw" jsonb NOT NULL,
	"raw_hash" text NOT NULL,
	"sw_updated_at" timestamp with time zone,
	"sw_deleted_at" timestamp with time zone,
	"last_seen_sync_id" uuid,
	"missing_since" timestamp with time zone,
	"accounting_date" date NOT NULL,
	"month" text NOT NULL,
	"description" text NOT NULL,
	"cost_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"my_owed_minor" bigint,
	"my_paid_minor" bigint,
	"group_id" bigint,
	"group_name" text,
	"sw_category" text,
	"status" text NOT NULL,
	"reason" text NOT NULL,
	"reason_text" text NOT NULL,
	"share_minor" bigint NOT NULL,
	"derivation" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "splitwise_expenses_month" CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"range_from" date,
	"range_to" date,
	"updated_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"counts" jsonb,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "usd_confirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"splitwise_id" bigint NOT NULL,
	"usd_minor" bigint NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_defaults" ADD CONSTRAINT "budget_defaults_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_defaults" ADD CONSTRAINT "budget_defaults_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_overrides" ADD CONSTRAINT "category_overrides_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_overrides" ADD CONSTRAINT "category_overrides_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "csv_imports" ADD CONSTRAINT "csv_imports_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "csv_rows" ADD CONSTRAINT "csv_rows_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "csv_rows" ADD CONSTRAINT "csv_rows_import_id_csv_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."csv_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_decisions" ADD CONSTRAINT "expense_decisions_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "history_summaries" ADD CONSTRAINT "history_summaries_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "history_summaries" ADD CONSTRAINT "history_summaries_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_entries" ADD CONSTRAINT "income_entries_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_rules" ADD CONSTRAINT "keyword_rules_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lender_payments" ADD CONSTRAINT "lender_payments_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lender_payments" ADD CONSTRAINT "lender_payments_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_disbursements" ADD CONSTRAINT "loan_disbursements_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_disbursements" ADD CONSTRAINT "loan_disbursements_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_rates" ADD CONSTRAINT "loan_rates_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_rates" ADD CONSTRAINT "loan_rates_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_schedules" ADD CONSTRAINT "loan_schedules_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_schedules" ADD CONSTRAINT "loan_schedules_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_expenses" ADD CONSTRAINT "manual_expenses_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_expenses" ADD CONSTRAINT "manual_expenses_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "month_budgets" ADD CONSTRAINT "month_budgets_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "month_budgets" ADD CONSTRAINT "month_budgets_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "months" ADD CONSTRAINT "months_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payoff_scenarios" ADD CONSTRAINT "payoff_scenarios_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payoff_scenarios" ADD CONSTRAINT "payoff_scenarios_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_overrides" ADD CONSTRAINT "recurring_overrides_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sister_reimbursements" ADD CONSTRAINT "sister_reimbursements_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sister_reimbursements" ADD CONSTRAINT "sister_reimbursements_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "splitwise_category_maps" ADD CONSTRAINT "splitwise_category_maps_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "splitwise_category_maps" ADD CONSTRAINT "splitwise_category_maps_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "splitwise_expenses" ADD CONSTRAINT "splitwise_expenses_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "splitwise_expenses" ADD CONSTRAINT "splitwise_expenses_last_seen_sync_id_sync_runs_id_fk" FOREIGN KEY ("last_seen_sync_id") REFERENCES "public"."sync_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usd_confirmations" ADD CONSTRAINT "usd_confirmations_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_owner_entity" ON "audit_log" USING btree ("owner_id","entity","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_defaults_unique" ON "budget_defaults" USING btree ("owner_id","category_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_owner_name" ON "categories" USING btree ("owner_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "category_overrides_unique" ON "category_overrides" USING btree ("owner_id","row_key");--> statement-breakpoint
CREATE UNIQUE INDEX "csv_imports_owner_sha" ON "csv_imports" USING btree ("owner_id","sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "csv_rows_import_key" ON "csv_rows" USING btree ("import_id","row_key");--> statement-breakpoint
CREATE INDEX "csv_rows_owner_month" ON "csv_rows" USING btree ("owner_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_decisions_active_row" ON "expense_decisions" USING btree ("owner_id","row_key") WHERE "expense_decisions"."state" = 'pinned';--> statement-breakpoint
CREATE UNIQUE INDEX "expense_decisions_spec" ON "expense_decisions" USING btree ("owner_id","spec_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_decisions_idem" ON "expense_decisions" USING btree ("owner_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "history_summaries_unique" ON "history_summaries" USING btree ("owner_id","month","category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "income_entries_idem" ON "income_entries" USING btree ("owner_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "income_entries_owner_date" ON "income_entries" USING btree ("owner_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "keyword_rules_unique" ON "keyword_rules" USING btree ("owner_id","kind","keyword");--> statement-breakpoint
CREATE UNIQUE INDEX "lender_payments_idem" ON "lender_payments" USING btree ("owner_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "loan_disbursements_seed" ON "loan_disbursements" USING btree ("owner_id","seed_key");--> statement-breakpoint
CREATE UNIQUE INDEX "loan_rates_unique" ON "loan_rates" USING btree ("loan_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "loan_schedules_unique" ON "loan_schedules" USING btree ("loan_id","issued_on");--> statement-breakpoint
CREATE UNIQUE INDEX "loans_seed" ON "loans" USING btree ("owner_id","seed_key");--> statement-breakpoint
CREATE UNIQUE INDEX "manual_expenses_idem" ON "manual_expenses" USING btree ("owner_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "manual_expenses_owner_month" ON "manual_expenses" USING btree ("owner_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "month_budgets_unique" ON "month_budgets" USING btree ("owner_id","month","category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "months_unique" ON "months" USING btree ("owner_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_overrides_unique" ON "recurring_overrides" USING btree ("owner_id","series","month");--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_rules_unique" ON "recurring_rules" USING btree ("owner_id","series","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "sister_reimbursements_idem" ON "sister_reimbursements" USING btree ("owner_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "sw_category_maps_unique" ON "splitwise_category_maps" USING btree ("owner_id","splitwise_name");--> statement-breakpoint
CREATE UNIQUE INDEX "splitwise_expenses_owner_sw" ON "splitwise_expenses" USING btree ("owner_id","splitwise_id");--> statement-breakpoint
CREATE INDEX "splitwise_expenses_owner_month" ON "splitwise_expenses" USING btree ("owner_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "usd_confirmations_unique" ON "usd_confirmations" USING btree ("owner_id","splitwise_id");