ALTER TABLE "users" ADD COLUMN "is_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_disabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "registration_code_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_registration_code_id_registration_codes_id_fk" FOREIGN KEY ("registration_code_id") REFERENCES "public"."registration_codes"("id") ON DELETE set null ON UPDATE no action;