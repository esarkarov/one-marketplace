ALTER TABLE "contracts" ADD COLUMN "refund_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "refund_next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "refund_last_error" text;--> statement-breakpoint
CREATE INDEX "contracts_refund_retry_idx" ON "contracts" USING btree ("refund_next_attempt_at") WHERE "contracts"."status" = 'CANCELLED' AND "contracts"."refunded_at" IS NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_refund_attempts_check" CHECK ("contracts"."refund_attempts" >= 0);