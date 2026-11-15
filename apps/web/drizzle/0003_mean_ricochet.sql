CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"virtual_member_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "api_tokens_virtual_member_id_unique" UNIQUE("virtual_member_id")
);
--> statement-breakpoint
CREATE TABLE "virtual_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"description" text,
	"accent_color" text,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "virtual_members_team_id_name_unique" UNIQUE("team_id","name")
);
--> statement-breakpoint
ALTER TABLE "comments" ALTER COLUMN "author_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "author_virtual_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "actor_virtual_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "assignee_virtual_id" uuid;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "kind" text DEFAULT 'real' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_virtual_member_id_virtual_members_id_fk" FOREIGN KEY ("virtual_member_id") REFERENCES "public"."virtual_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "virtual_members" ADD CONSTRAINT "virtual_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "virtual_members" ADD CONSTRAINT "virtual_members_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "virtual_members_team_id_idx" ON "virtual_members" USING btree ("team_id");--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_virtual_id_virtual_members_id_fk" FOREIGN KEY ("author_virtual_id") REFERENCES "public"."virtual_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_virtual_id_virtual_members_id_fk" FOREIGN KEY ("actor_virtual_id") REFERENCES "public"."virtual_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_virtual_id_virtual_members_id_fk" FOREIGN KEY ("assignee_virtual_id") REFERENCES "public"."virtual_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_assignee_virtual_id_idx" ON "tasks" USING btree ("assignee_virtual_id");--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_exclusive_check" CHECK (NOT ("comments"."author_id" IS NOT NULL AND "comments"."author_virtual_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_exclusive_check" CHECK (NOT ("notifications"."actor_id" IS NOT NULL AND "notifications"."actor_virtual_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_exclusive_check" CHECK (NOT ("tasks"."assignee_id" IS NOT NULL AND "tasks"."assignee_virtual_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_kind_check" CHECK ("teams"."kind" IN ('real', 'virtual'));