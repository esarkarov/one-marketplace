DROP INDEX "agency_members_agency_freelancer_unique";--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "recipient_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "agency_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_agency_id_agency_metadata_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agency_metadata"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_members" ADD CONSTRAINT "agency_members_freelancer_id_unique" UNIQUE("freelancer_id");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_target_check" CHECK (("notifications"."recipient_id" IS NOT NULL) <> ("notifications"."agency_id" IS NOT NULL));