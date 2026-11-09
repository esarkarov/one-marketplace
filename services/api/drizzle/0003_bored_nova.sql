CREATE TABLE "job_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"expertise_level" text NOT NULL,
	"expected_duration" text NOT NULL,
	"skills" text[] DEFAULT '{}' NOT NULL,
	"total_budget" numeric(9, 2) NOT NULL,
	"milestones" jsonb NOT NULL,
	"screening_questions" text[] DEFAULT '{}',
	"attachments" jsonb DEFAULT '[]'::jsonb,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"published_at" timestamp with time zone,
	"hired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "job_posts" ADD CONSTRAINT "job_posts_client_id_accounts_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;