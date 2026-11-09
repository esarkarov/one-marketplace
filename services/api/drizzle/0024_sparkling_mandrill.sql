CREATE TABLE "agency_portfolios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"live_url" text,
	"cover_image" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "agency_metadata" ADD COLUMN "professional_title" text;--> statement-breakpoint
ALTER TABLE "agency_metadata" ADD COLUMN "tags" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "agency_metadata" ADD COLUMN "is_onboarded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agency_portfolios" ADD CONSTRAINT "agency_portfolios_agency_id_agency_metadata_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agency_metadata"("id") ON DELETE cascade ON UPDATE no action;