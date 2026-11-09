CREATE TABLE "payout_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"freelancer_id" text NOT NULL,
	"earning_history_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"stripe_transfer_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_history_earning_history_id_unique" UNIQUE("earning_history_id"),
	CONSTRAINT "payout_history_stripe_transfer_id_unique" UNIQUE("stripe_transfer_id"),
	CONSTRAINT "payout_history_amount_check" CHECK ("payout_history"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "payout_history" ADD CONSTRAINT "payout_history_freelancer_id_accounts_auth_id_fk" FOREIGN KEY ("freelancer_id") REFERENCES "public"."accounts"("auth_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_history" ADD CONSTRAINT "payout_history_earning_history_id_earning_history_id_fk" FOREIGN KEY ("earning_history_id") REFERENCES "public"."earning_history"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payout_history_freelancer_created_idx" ON "payout_history" USING btree ("freelancer_id","created_at");