DROP TABLE "csv_rows" CASCADE;--> statement-breakpoint
ALTER TABLE "csv_imports" ADD COLUMN "content" text NOT NULL;--> statement-breakpoint
ALTER TABLE "months" ADD COLUMN "kept_diff_hash" text;