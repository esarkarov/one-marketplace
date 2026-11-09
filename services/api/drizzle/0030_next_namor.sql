CREATE TABLE "agency_earning" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"total_earning" numeric(12, 2) DEFAULT '0' NOT NULL,
	"completed_jobs" integer DEFAULT 0 NOT NULL,
	"ongoing_jobs" integer DEFAULT 0 NOT NULL,
	"review_count" integer DEFAULT 0 NOT NULL,
	"job_success_score" numeric(5, 2) DEFAULT '0' NOT NULL,
	"rating" numeric(3, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agency_earning_agency_id_unique" UNIQUE("agency_id"),
	CONSTRAINT "agency_earning_total_check" CHECK ("agency_earning"."total_earning" >= 0),
	CONSTRAINT "agency_earning_completed_check" CHECK ("agency_earning"."completed_jobs" >= 0),
	CONSTRAINT "agency_earning_ongoing_check" CHECK ("agency_earning"."ongoing_jobs" >= 0),
	CONSTRAINT "agency_earning_reviews_check" CHECK ("agency_earning"."review_count" >= 0),
	CONSTRAINT "agency_earning_success_check" CHECK ("agency_earning"."job_success_score" BETWEEN 0 AND 100),
	CONSTRAINT "agency_earning_rating_check" CHECK ("agency_earning"."rating" BETWEEN 0 AND 5)
);
--> statement-breakpoint
ALTER TABLE "earning_history" ALTER COLUMN "freelancer_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "earning_history" ADD COLUMN "agency_id" uuid;--> statement-breakpoint
ALTER TABLE "agency_earning" ADD CONSTRAINT "agency_earning_agency_id_agency_metadata_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agency_metadata"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "earning_history" ADD CONSTRAINT "earning_history_agency_id_agency_metadata_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agency_metadata"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "earning_history_agency_created_idx" ON "earning_history" USING btree ("agency_id","created_at");--> statement-breakpoint
ALTER TABLE "earning_history" ADD CONSTRAINT "earning_history_owner_check" CHECK (("earning_history"."freelancer_id" IS NOT NULL) <> ("earning_history"."agency_id" IS NOT NULL));