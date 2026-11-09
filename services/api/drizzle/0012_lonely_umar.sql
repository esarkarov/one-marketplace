CREATE TABLE "freelancer_saved_job_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"freelancer_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "freelancer_saved_job_posts" ADD CONSTRAINT "freelancer_saved_job_posts_job_id_job_posts_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freelancer_saved_job_posts" ADD CONSTRAINT "freelancer_saved_job_posts_freelancer_id_freelancer_metadata_auth_id_fk" FOREIGN KEY ("freelancer_id") REFERENCES "public"."freelancer_metadata"("auth_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "freelancer_saved_job_posts_freelancer_job_unique" ON "freelancer_saved_job_posts" USING btree ("freelancer_id","job_id");