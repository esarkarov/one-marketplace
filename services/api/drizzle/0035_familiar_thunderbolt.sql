ALTER TABLE "payout_history" ALTER COLUMN "freelancer_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agency_metadata" ADD COLUMN "stripe_connect_account_id" text;--> statement-breakpoint
ALTER TABLE "payout_history" ADD COLUMN "agency_id" uuid;--> statement-breakpoint
ALTER TABLE "payout_history" ADD CONSTRAINT "payout_history_agency_id_agency_metadata_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agency_metadata"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payout_history_agency_created_idx" ON "payout_history" USING btree ("agency_id","created_at");--> statement-breakpoint
ALTER TABLE "payout_history" ADD CONSTRAINT "payout_history_owner_check" CHECK (("payout_history"."freelancer_id" IS NOT NULL) <> ("payout_history"."agency_id" IS NOT NULL));