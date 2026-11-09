CREATE TABLE "client_spents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text NOT NULL,
	"total_spent" numeric(12, 2) DEFAULT '0' NOT NULL,
	"completed_contracts" integer DEFAULT 0 NOT NULL,
	"ongoing_contracts" integer DEFAULT 0 NOT NULL,
	"review_count" integer DEFAULT 0 NOT NULL,
	"rating" numeric(3, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_spents_client_id_unique" UNIQUE("client_id"),
	CONSTRAINT "client_spents_total_check" CHECK ("client_spents"."total_spent" >= 0),
	CONSTRAINT "client_spents_completed_check" CHECK ("client_spents"."completed_contracts" >= 0),
	CONSTRAINT "client_spents_ongoing_check" CHECK ("client_spents"."ongoing_contracts" >= 0),
	CONSTRAINT "client_spents_reviews_check" CHECK ("client_spents"."review_count" >= 0),
	CONSTRAINT "client_spents_rating_check" CHECK ("client_spents"."rating" BETWEEN 0 AND 5)
);
--> statement-breakpoint
CREATE TABLE "freelancer_earning" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"freelancer_id" text NOT NULL,
	"total_earning" numeric(12, 2) DEFAULT '0' NOT NULL,
	"completed_jobs" integer DEFAULT 0 NOT NULL,
	"ongoing_jobs" integer DEFAULT 0 NOT NULL,
	"review_count" integer DEFAULT 0 NOT NULL,
	"job_success_score" numeric(5, 2) DEFAULT '0' NOT NULL,
	"rating" numeric(3, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "freelancer_earning_freelancer_id_unique" UNIQUE("freelancer_id"),
	CONSTRAINT "freelancer_earning_total_check" CHECK ("freelancer_earning"."total_earning" >= 0),
	CONSTRAINT "freelancer_earning_completed_check" CHECK ("freelancer_earning"."completed_jobs" >= 0),
	CONSTRAINT "freelancer_earning_ongoing_check" CHECK ("freelancer_earning"."ongoing_jobs" >= 0),
	CONSTRAINT "freelancer_earning_reviews_check" CHECK ("freelancer_earning"."review_count" >= 0),
	CONSTRAINT "freelancer_earning_success_check" CHECK ("freelancer_earning"."job_success_score" BETWEEN 0 AND 100),
	CONSTRAINT "freelancer_earning_rating_check" CHECK ("freelancer_earning"."rating" BETWEEN 0 AND 5)
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"reviewer_id" text NOT NULL,
	"reviewee_id" text NOT NULL,
	"rating" integer NOT NULL,
	"comment" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_rating_check" CHECK ("reviews"."rating" BETWEEN 1 AND 5),
	CONSTRAINT "reviews_different_accounts_check" CHECK ("reviews"."reviewer_id" <> "reviews"."reviewee_id")
);
--> statement-breakpoint
ALTER TABLE "client_spents" ADD CONSTRAINT "client_spents_client_id_accounts_auth_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."accounts"("auth_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freelancer_earning" ADD CONSTRAINT "freelancer_earning_freelancer_id_accounts_auth_id_fk" FOREIGN KEY ("freelancer_id") REFERENCES "public"."accounts"("auth_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewer_id_accounts_auth_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."accounts"("auth_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewee_id_accounts_auth_id_fk" FOREIGN KEY ("reviewee_id") REFERENCES "public"."accounts"("auth_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_contract_reviewer_unique" ON "reviews" USING btree ("contract_id","reviewer_id");--> statement-breakpoint
CREATE INDEX "reviews_reviewee_created_idx" ON "reviews" USING btree ("reviewee_id","created_at");