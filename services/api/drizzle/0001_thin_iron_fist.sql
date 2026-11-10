ALTER TABLE "payout_history" ALTER COLUMN "stripe_transfer_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payout_history" ADD COLUMN "status" text DEFAULT 'PAID' NOT NULL;--> statement-breakpoint
ALTER TABLE "payout_history" ALTER COLUMN "status" SET DEFAULT 'PENDING';--> statement-breakpoint
ALTER TABLE "payout_history" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payout_history" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payout_history" ADD COLUMN "next_retry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payout_history" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payout_history" ADD COLUMN "notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payout_history" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "payout_history" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "payout_history" ADD COLUMN "destination_account_id" text;--> statement-breakpoint
UPDATE "payout_history" SET "paid_at" = "created_at", "notified_at" = "created_at" WHERE "status" = 'PAID';--> statement-breakpoint
CREATE INDEX "payout_history_open_idx" ON "payout_history" USING btree ("status",COALESCE("next_retry_at", "claimed_at")) WHERE "payout_history"."status" IN ('PENDING', 'PROCESSING', 'FAILED');--> statement-breakpoint
ALTER TABLE "payout_history" ADD CONSTRAINT "payout_history_status_check" CHECK ("payout_history"."status" IN ('PENDING', 'PROCESSING', 'PAID', 'FAILED'));--> statement-breakpoint
ALTER TABLE "payout_history" ADD CONSTRAINT "payout_history_paid_has_transfer_check" CHECK (("payout_history"."status" = 'PAID') = ("payout_history"."stripe_transfer_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "payout_history" ADD CONSTRAINT "payout_history_attempts_check" CHECK ("payout_history"."attempts" >= 0);
