ALTER TABLE "connects" ALTER COLUMN "freelancer_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "connects" ADD COLUMN "agency_id" uuid;--> statement-breakpoint
ALTER TABLE "connects" ADD CONSTRAINT "connects_agency_id_agency_metadata_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agency_metadata"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connects" ADD CONSTRAINT "connects_agency_id_unique" UNIQUE("agency_id");--> statement-breakpoint
ALTER TABLE "connects" ADD CONSTRAINT "connects_owner_check" CHECK (("connects"."freelancer_id" IS NOT NULL) <> ("connects"."agency_id" IS NOT NULL));