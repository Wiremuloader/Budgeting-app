ALTER TABLE "user_preferences" ADD COLUMN "email_digest" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "last_digest_on" text;