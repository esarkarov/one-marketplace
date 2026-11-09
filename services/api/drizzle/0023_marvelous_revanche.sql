CREATE TABLE "agency_metadata" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"size" text NOT NULL,
	"specialty" text NOT NULL,
	"website" text,
	"overview" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agency_metadata_owner_id_unique" UNIQUE("owner_id")
);
--> statement-breakpoint
ALTER TABLE "agency_metadata" ADD CONSTRAINT "agency_metadata_owner_id_accounts_auth_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."accounts"("auth_id") ON DELETE cascade ON UPDATE no action;