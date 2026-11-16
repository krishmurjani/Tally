ALTER TABLE "inbox_items" ADD COLUMN "splitwise_expense_id" bigint;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "post_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "post_error" text;--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_items_splitwise" ON "inbox_items" USING btree ("owner_id","splitwise_expense_id") WHERE "inbox_items"."splitwise_expense_id" is not null;