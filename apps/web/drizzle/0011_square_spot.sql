CREATE TABLE "project_members" (
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "project_members_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "status" text DEFAULT 'backlog' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "lead_id" uuid;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_members_user_id_idx" ON "project_members" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_lead_id_users_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- 回填：全部完成 → completed
UPDATE "projects" SET "status" = 'completed'
WHERE EXISTS (SELECT 1 FROM "tasks" "t" WHERE "t"."project_id" = "projects"."id" AND "t"."status" = 'done')
  AND NOT EXISTS (SELECT 1 FROM "tasks" "t" WHERE "t"."project_id" = "projects"."id" AND "t"."status" <> 'done');
--> statement-breakpoint
-- 回填：有未完任务且有进行中任务 → in_progress（其余留在默认 backlog）
UPDATE "projects" SET "status" = 'in_progress'
WHERE "status" = 'backlog'
  AND EXISTS (SELECT 1 FROM "tasks" "t" WHERE "t"."project_id" = "projects"."id" AND "t"."status" = 'in_progress');
