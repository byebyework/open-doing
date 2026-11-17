CREATE TABLE "moments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" text NOT NULL,
	"mode" text NOT NULL,
	"anchor_date" date NOT NULL,
	"cycle" text,
	"weekday" integer,
	"day_of_month" integer,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moments_shape" CHECK (((mode IN ('count_up','countdown') AND cycle IS NULL AND weekday IS NULL AND day_of_month IS NULL)
        OR (mode = 'periodic' AND cycle IS NOT NULL
            AND ((cycle = 'daily' AND weekday IS NULL AND day_of_month IS NULL)
              OR (cycle = 'weekly' AND weekday IS NOT NULL AND weekday BETWEEN 0 AND 6 AND day_of_month IS NULL)
              OR (cycle = 'monthly' AND day_of_month IS NOT NULL AND day_of_month BETWEEN 1 AND 31 AND weekday IS NULL)
              OR (cycle = 'yearly' AND weekday IS NULL AND day_of_month IS NULL)))))
);
--> statement-breakpoint
ALTER TABLE "moments" ADD CONSTRAINT "moments_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "moments_owner_id_idx" ON "moments" USING btree ("owner_id");