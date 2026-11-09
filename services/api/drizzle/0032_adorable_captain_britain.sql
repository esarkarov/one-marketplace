CREATE TABLE "agency_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"role" text DEFAULT 'Agency member' NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"invited_by" text NOT NULL,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agency_invitations" ADD CONSTRAINT "agency_invitations_agency_id_agency_metadata_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agency_metadata"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_invitations" ADD CONSTRAINT "agency_invitations_invited_by_accounts_auth_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."accounts"("auth_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agency_invitations_email_status_idx" ON "agency_invitations" USING btree ("email","status");--> statement-breakpoint
CREATE INDEX "agency_invitations_agency_status_idx" ON "agency_invitations" USING btree ("agency_id","status");