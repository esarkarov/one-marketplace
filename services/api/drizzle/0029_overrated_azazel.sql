ALTER TABLE "contracts" ALTER COLUMN "freelancer_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "agency_id" uuid;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_agency_id_agency_metadata_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agency_metadata"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_owner_check" CHECK (("contracts"."freelancer_id" IS NOT NULL) <> ("contracts"."agency_id" IS NOT NULL));