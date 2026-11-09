CREATE TYPE "public"."account_role" AS ENUM('FREELANCER', 'CLIENT');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_id" text NOT NULL,
	"email" text NOT NULL,
	"role" "account_role" DEFAULT 'CLIENT' NOT NULL,
	"identityVerified" boolean DEFAULT false,
	"paymentMethodVerified" boolean DEFAULT false,
	"isOnboardingComplete" boolean DEFAULT false,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "client_metadata" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_id" text NOT NULL,
	"role" text NOT NULL,
	"company_name" text NOT NULL,
	"company_website" text NOT NULL,
	"company_size" text NOT NULL,
	"industry" text NOT NULL,
	"company_description" text NOT NULL,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	CONSTRAINT "client_metadata_auth_id_unique" UNIQUE("auth_id")
);
