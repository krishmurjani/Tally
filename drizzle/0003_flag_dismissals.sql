CREATE TABLE "flag_dismissals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"row_key" text NOT NULL,
	"flag" text DEFAULT 'large' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "flag_dismissals" ADD CONSTRAINT "flag_dismissals_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "flag_dismissals_unique" ON "flag_dismissals" USING btree ("owner_id","row_key","flag");