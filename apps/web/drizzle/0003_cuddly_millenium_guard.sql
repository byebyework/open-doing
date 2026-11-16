ALTER TABLE "users" ADD COLUMN "agreed_tos_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "agreed_tos_version" text;