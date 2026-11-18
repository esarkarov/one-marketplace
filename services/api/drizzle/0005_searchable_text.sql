ALTER TABLE "agency_metadata" ADD COLUMN "search_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "avatar_url" text;--> statement-breakpoint
ALTER TABLE "freelancer_metadata" ADD COLUMN "search_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "freelancer_metadata" ADD COLUMN "location_text" text DEFAULT '' NOT NULL;