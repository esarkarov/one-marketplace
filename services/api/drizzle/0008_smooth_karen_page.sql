ALTER TABLE "accounts" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_stripe_customer_id_unique" UNIQUE("stripe_customer_id");