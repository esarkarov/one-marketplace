ALTER TABLE "reviews" ADD COLUMN "agency_id" uuid;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_agency_id_agency_metadata_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agency_metadata"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reviews_agency_created_idx" ON "reviews" USING btree ("agency_id","created_at");