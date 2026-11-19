ALTER TABLE "contracts" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "cancelled_by" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "refund_id" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "refunded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_cancelled_by_check" CHECK ("contracts"."cancelled_by" IN ('CLIENT', 'TALENT'));--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_cancel_facts_check" CHECK (("contracts"."cancelled_at" IS NULL) = ("contracts"."cancelled_by" IS NULL));--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_refunded_status_check" CHECK ("contracts"."refunded_at" IS NULL OR "contracts"."status" = 'CANCELLED');