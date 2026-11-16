CREATE TABLE "important_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" text NOT NULL,
	"date" date,
	"is_lunar" boolean DEFAULT false NOT NULL,
	"lunar_month" integer,
	"lunar_day" integer,
	"repeat" text NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "important_days_shape" CHECK ((is_lunar = true AND date IS NULL AND lunar_month BETWEEN 1 AND 12 AND lunar_day BETWEEN 1 AND 30 AND repeat = 'yearly')
       OR (is_lunar = false AND date IS NOT NULL AND lunar_month IS NULL AND lunar_day IS NULL))
);
--> statement-breakpoint
ALTER TABLE "important_days" ADD CONSTRAINT "important_days_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "important_days_owner_id_idx" ON "important_days" USING btree ("owner_id");