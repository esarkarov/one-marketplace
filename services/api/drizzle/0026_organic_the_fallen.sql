CREATE TABLE "agency_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"freelancer_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agency_members" ADD CONSTRAINT "agency_members_agency_id_agency_metadata_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agency_metadata"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_members" ADD CONSTRAINT "agency_members_freelancer_id_accounts_auth_id_fk" FOREIGN KEY ("freelancer_id") REFERENCES "public"."accounts"("auth_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agency_members_agency_freelancer_unique" ON "agency_members" USING btree ("agency_id","freelancer_id");