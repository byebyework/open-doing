ALTER TABLE "teams" ADD COLUMN "join_code" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "join_code_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
DO $$
DECLARE t record; code text;
BEGIN
  FOR t IN SELECT id FROM teams LOOP
    LOOP
      code := (SELECT string_agg(ch, '') FROM (
        SELECT substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', 1 + floor(random() * 31)::int, 1) AS ch
        FROM generate_series(1, 8)) s);
      BEGIN
        UPDATE teams SET join_code = code WHERE id = t.id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN NULL;
      END;
    END LOOP;
  END LOOP;
END $$;--> statement-breakpoint
ALTER TABLE "teams" ALTER COLUMN "join_code" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "teams_join_code_unique" ON "teams" USING btree ("join_code");--> statement-breakpoint
CREATE TABLE "team_join_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	"responded_by_id" uuid
);
--> statement-breakpoint
ALTER TABLE "team_join_requests" ADD CONSTRAINT "team_join_requests_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_join_requests" ADD CONSTRAINT "team_join_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_join_requests" ADD CONSTRAINT "team_join_requests_responded_by_id_users_id_fk" FOREIGN KEY ("responded_by_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "team_join_requests_pending_team_user_unique" ON "team_join_requests" USING btree ("team_id","user_id") WHERE "team_join_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "team_join_requests_user_id_idx" ON "team_join_requests" USING btree ("user_id");
