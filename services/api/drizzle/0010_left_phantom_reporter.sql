CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"sender_id" text NOT NULL,
	"sender_type" text NOT NULL,
	"cover_letter" text NOT NULL,
	"bid_amount" numeric(9, 2) NOT NULL,
	"duration" text NOT NULL,
	"screening_answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'SUBMITTED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_job_id_job_posts_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job_posts"("id") ON DELETE cascade ON UPDATE no action;