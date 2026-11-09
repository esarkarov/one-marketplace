CREATE TABLE "freelancer_metadata" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_id" text NOT NULL,
	"professional_title" text NOT NULL,
	"professional_description" text NOT NULL,
	"hourly_rate" numeric(6, 2) NOT NULL,
	"country" text NOT NULL,
	"city" text NOT NULL,
	"availability_status" text DEFAULT 'AVAILABLE' NOT NULL,
	"weekly_availability" text NOT NULL,
	"experience_level" text NOT NULL,
	"skills" text[] DEFAULT '{}' NOT NULL,
	"languages" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "freelancer_metadata_auth_id_unique" UNIQUE("auth_id")
);
--> statement-breakpoint
CREATE TABLE "freelancer_portfolios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"freelancer_id" uuid NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"live_url" text,
	"cover_image" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "freelancer_portfolios" ADD CONSTRAINT "freelancer_portfolios_freelancer_id_freelancer_metadata_id_fk" FOREIGN KEY ("freelancer_id") REFERENCES "public"."freelancer_metadata"("id") ON DELETE cascade ON UPDATE no action;