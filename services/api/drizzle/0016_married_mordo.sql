ALTER TABLE "contract_milestones" ADD COLUMN "stripe_checkout_session_id" text;--> statement-breakpoint
ALTER TABLE "contract_milestones" ADD COLUMN "stripe_payment_intent_id" text;--> statement-breakpoint
ALTER TABLE "contract_milestones" ADD COLUMN "funded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contract_milestones" ADD CONSTRAINT "contract_milestones_stripe_checkout_session_id_unique" UNIQUE("stripe_checkout_session_id");--> statement-breakpoint
ALTER TABLE "contract_milestones" ADD CONSTRAINT "contract_milestones_stripe_payment_intent_id_unique" UNIQUE("stripe_payment_intent_id");