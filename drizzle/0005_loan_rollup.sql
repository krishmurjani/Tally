ALTER TABLE "loan_schedules" ADD COLUMN "principal_at_rollup_minor" bigint;--> statement-breakpoint
ALTER TABLE "loan_schedules" ADD COLUMN "rollup_through" date;--> statement-breakpoint
ALTER TABLE "loan_schedules" ADD COLUMN "tenure_months" integer;