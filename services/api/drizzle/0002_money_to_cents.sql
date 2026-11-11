CREATE FUNCTION pg_temp.money_to_cents(v jsonb, ctx text) RETURNS bigint LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE n numeric;
BEGIN
  IF v IS NULL OR jsonb_typeof(v) <> 'number' THEN
    RAISE EXCEPTION 'money migration: % is missing or not a number: %', ctx, v;
  END IF;
  n := (v #>> '{}')::numeric;
  IF n < 0 OR n * 100 <> trunc(n * 100) THEN
    RAISE EXCEPTION 'money migration: % is negative or has more than 2 decimals: %', ctx, n;
  END IF;
  IF n * 100 > 9007199254740991 THEN
    RAISE EXCEPTION 'money migration: % exceeds the safe integer limit in cents: %', ctx, n;
  END IF;
  RETURN (n * 100)::bigint;
END
$$;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM connects_purchase_history WHERE amount_paid < 0 OR amount_paid * 100 <> trunc(amount_paid * 100)) THEN
    RAISE EXCEPTION 'money migration: connects_purchase_history.amount_paid has negative values or more than 2 decimals';
  END IF;
  IF EXISTS (SELECT 1 FROM job_posts WHERE jsonb_typeof(milestones) <> 'array') THEN
    RAISE EXCEPTION 'money migration: job_posts.milestones is not an array on some row';
  END IF;
END
$$;--> statement-breakpoint
UPDATE "job_posts" jp SET "milestones" = (
  SELECT coalesce(jsonb_agg(
    (e.value - 'budget') || jsonb_build_object('budgetCents',
      pg_temp.money_to_cents(e.value -> 'budget', format('job_posts.%s.milestones[%s].budget', jp.id, e.ord - 1)))
    ORDER BY e.ord), '[]'::jsonb)
  FROM jsonb_array_elements(jp."milestones") WITH ORDINALITY AS e(value, ord)
);--> statement-breakpoint
UPDATE "messages" SET "event_payload" = ("event_payload" - 'amount') || jsonb_build_object('amountCents',
  pg_temp.money_to_cents("event_payload" -> 'amount', format('messages.%s.event_payload.amount', id)))
WHERE "event_type" IN ('MILESTONE_FUNDED', 'MILESTONE_SUBMITTED', 'MILESTONE_APPROVED', 'MILESTONE_CHANGES_REQUESTED', 'MILESTONE_ADDED');--> statement-breakpoint
UPDATE "messages" SET "event_payload" = jsonb_set("event_payload", '{firstMilestone}',
  (("event_payload" -> 'firstMilestone') - 'amount') || jsonb_build_object('amountCents',
    pg_temp.money_to_cents("event_payload" -> 'firstMilestone' -> 'amount', format('messages.%s.event_payload.firstMilestone.amount', id))))
WHERE "event_type" = 'CONTRACT_OFFER';--> statement-breakpoint
UPDATE "notifications" SET "metadata" = ("metadata" - 'amount') || jsonb_build_object('amountCents',
  pg_temp.money_to_cents("metadata" -> 'amount', format('notifications.%s.metadata.amount', id)))
WHERE "type" = 'PAYOUT_COMPLETED';--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM messages WHERE jsonb_path_exists(event_payload, '$.**.amount')) THEN
    RAISE EXCEPTION 'money migration: messages.event_payload still has an amount key (unhandled event_type)';
  END IF;
  IF EXISTS (SELECT 1 FROM notifications WHERE jsonb_path_exists(metadata, '$.**.amount')) THEN
    RAISE EXCEPTION 'money migration: notifications.metadata still has an amount key (unhandled type)';
  END IF;
  IF EXISTS (SELECT 1 FROM job_posts WHERE jsonb_path_exists(milestones, '$.**.budget')) THEN
    RAISE EXCEPTION 'money migration: job_posts.milestones still has a budget key';
  END IF;
END
$$;--> statement-breakpoint
DROP FUNCTION pg_temp.money_to_cents(jsonb, text);--> statement-breakpoint
ALTER TABLE "contracts" DROP CONSTRAINT "contracts_total_amount_check";--> statement-breakpoint
ALTER TABLE "contract_milestones" DROP CONSTRAINT "contract_milestones_amount_check";--> statement-breakpoint
ALTER TABLE "freelancer_earning" DROP CONSTRAINT "freelancer_earning_total_check";--> statement-breakpoint
ALTER TABLE "agency_earning" DROP CONSTRAINT "agency_earning_total_check";--> statement-breakpoint
ALTER TABLE "earning_history" DROP CONSTRAINT "earning_history_amount_check";--> statement-breakpoint
ALTER TABLE "earning_history" DROP CONSTRAINT "earning_history_fee_check";--> statement-breakpoint
ALTER TABLE "payout_history" DROP CONSTRAINT "payout_history_amount_check";--> statement-breakpoint
ALTER TABLE "client_spents" DROP CONSTRAINT "client_spents_total_check";--> statement-breakpoint
ALTER TABLE "freelancer_metadata" RENAME COLUMN "hourly_rate" TO "hourly_rate_cents";--> statement-breakpoint
ALTER TABLE "freelancer_metadata" ALTER COLUMN "hourly_rate_cents" SET DATA TYPE bigint USING ("hourly_rate_cents" * 100)::bigint;--> statement-breakpoint
ALTER TABLE "job_posts" RENAME COLUMN "total_budget" TO "total_budget_cents";--> statement-breakpoint
ALTER TABLE "job_posts" ALTER COLUMN "total_budget_cents" SET DATA TYPE bigint USING ("total_budget_cents" * 100)::bigint;--> statement-breakpoint
ALTER TABLE "proposals" RENAME COLUMN "bid_amount" TO "bid_amount_cents";--> statement-breakpoint
ALTER TABLE "proposals" ALTER COLUMN "bid_amount_cents" SET DATA TYPE bigint USING ("bid_amount_cents" * 100)::bigint;--> statement-breakpoint
ALTER TABLE "contracts" RENAME COLUMN "total_amount" TO "total_amount_cents";--> statement-breakpoint
ALTER TABLE "contracts" ALTER COLUMN "total_amount_cents" SET DATA TYPE bigint USING ("total_amount_cents" * 100)::bigint;--> statement-breakpoint
ALTER TABLE "contract_milestones" RENAME COLUMN "amount" TO "amount_cents";--> statement-breakpoint
ALTER TABLE "contract_milestones" ALTER COLUMN "amount_cents" SET DATA TYPE bigint USING ("amount_cents" * 100)::bigint;--> statement-breakpoint
ALTER TABLE "freelancer_earning" RENAME COLUMN "total_earning" TO "total_earning_cents";--> statement-breakpoint
ALTER TABLE "freelancer_earning" ALTER COLUMN "total_earning_cents" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "freelancer_earning" ALTER COLUMN "total_earning_cents" SET DATA TYPE bigint USING ("total_earning_cents" * 100)::bigint;--> statement-breakpoint
ALTER TABLE "freelancer_earning" ALTER COLUMN "total_earning_cents" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "agency_earning" RENAME COLUMN "total_earning" TO "total_earning_cents";--> statement-breakpoint
ALTER TABLE "agency_earning" ALTER COLUMN "total_earning_cents" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "agency_earning" ALTER COLUMN "total_earning_cents" SET DATA TYPE bigint USING ("total_earning_cents" * 100)::bigint;--> statement-breakpoint
ALTER TABLE "agency_earning" ALTER COLUMN "total_earning_cents" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "earning_history" RENAME COLUMN "amount" TO "amount_cents";--> statement-breakpoint
ALTER TABLE "earning_history" ALTER COLUMN "amount_cents" SET DATA TYPE bigint USING ("amount_cents" * 100)::bigint;--> statement-breakpoint
ALTER TABLE "earning_history" RENAME COLUMN "platform_fee_amount" TO "platform_fee_cents";--> statement-breakpoint
ALTER TABLE "earning_history" ALTER COLUMN "platform_fee_cents" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "earning_history" ALTER COLUMN "platform_fee_cents" SET DATA TYPE bigint USING ("platform_fee_cents" * 100)::bigint;--> statement-breakpoint
ALTER TABLE "earning_history" ALTER COLUMN "platform_fee_cents" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "payout_history" RENAME COLUMN "amount" TO "amount_cents";--> statement-breakpoint
ALTER TABLE "payout_history" ALTER COLUMN "amount_cents" SET DATA TYPE bigint USING ("amount_cents" * 100)::bigint;--> statement-breakpoint
ALTER TABLE "client_spents" RENAME COLUMN "total_spent" TO "total_spent_cents";--> statement-breakpoint
ALTER TABLE "client_spents" ALTER COLUMN "total_spent_cents" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "client_spents" ALTER COLUMN "total_spent_cents" SET DATA TYPE bigint USING ("total_spent_cents" * 100)::bigint;--> statement-breakpoint
ALTER TABLE "client_spents" ALTER COLUMN "total_spent_cents" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "connects_purchase_history" RENAME COLUMN "amount_paid" TO "amount_paid_cents";--> statement-breakpoint
ALTER TABLE "connects_purchase_history" ALTER COLUMN "amount_paid_cents" SET DATA TYPE bigint USING ("amount_paid_cents" * 100)::bigint;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_total_amount_cents_check" CHECK ("contracts"."total_amount_cents" > 0);--> statement-breakpoint
ALTER TABLE "contract_milestones" ADD CONSTRAINT "contract_milestones_amount_cents_check" CHECK ("contract_milestones"."amount_cents" > 0);--> statement-breakpoint
ALTER TABLE "freelancer_earning" ADD CONSTRAINT "freelancer_earning_total_earning_cents_check" CHECK ("freelancer_earning"."total_earning_cents" >= 0);--> statement-breakpoint
ALTER TABLE "agency_earning" ADD CONSTRAINT "agency_earning_total_earning_cents_check" CHECK ("agency_earning"."total_earning_cents" >= 0);--> statement-breakpoint
ALTER TABLE "earning_history" ADD CONSTRAINT "earning_history_amount_cents_check" CHECK ("earning_history"."amount_cents" > 0);--> statement-breakpoint
ALTER TABLE "earning_history" ADD CONSTRAINT "earning_history_platform_fee_cents_nonneg_check" CHECK ("earning_history"."platform_fee_cents" >= 0);--> statement-breakpoint
ALTER TABLE "earning_history" ADD CONSTRAINT "earning_history_platform_fee_cents_lt_amount_check" CHECK ("earning_history"."platform_fee_cents" < "earning_history"."amount_cents");--> statement-breakpoint
ALTER TABLE "payout_history" ADD CONSTRAINT "payout_history_amount_cents_check" CHECK ("payout_history"."amount_cents" > 0);--> statement-breakpoint
ALTER TABLE "client_spents" ADD CONSTRAINT "client_spents_total_spent_cents_check" CHECK ("client_spents"."total_spent_cents" >= 0);--> statement-breakpoint
ALTER TABLE "freelancer_metadata" ADD CONSTRAINT "freelancer_metadata_hourly_rate_cents_max_check" CHECK ("freelancer_metadata"."hourly_rate_cents" <= 9007199254740991);--> statement-breakpoint
ALTER TABLE "job_posts" ADD CONSTRAINT "job_posts_total_budget_cents_max_check" CHECK ("job_posts"."total_budget_cents" <= 9007199254740991);--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_bid_amount_cents_max_check" CHECK ("proposals"."bid_amount_cents" <= 9007199254740991);--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_total_amount_cents_max_check" CHECK ("contracts"."total_amount_cents" <= 9007199254740991);--> statement-breakpoint
ALTER TABLE "contract_milestones" ADD CONSTRAINT "contract_milestones_amount_cents_max_check" CHECK ("contract_milestones"."amount_cents" <= 9007199254740991);--> statement-breakpoint
ALTER TABLE "freelancer_earning" ADD CONSTRAINT "freelancer_earning_total_earning_cents_max_check" CHECK ("freelancer_earning"."total_earning_cents" <= 9007199254740991);--> statement-breakpoint
ALTER TABLE "agency_earning" ADD CONSTRAINT "agency_earning_total_earning_cents_max_check" CHECK ("agency_earning"."total_earning_cents" <= 9007199254740991);--> statement-breakpoint
ALTER TABLE "earning_history" ADD CONSTRAINT "earning_history_amount_cents_max_check" CHECK ("earning_history"."amount_cents" <= 9007199254740991);--> statement-breakpoint
ALTER TABLE "earning_history" ADD CONSTRAINT "earning_history_platform_fee_cents_max_check" CHECK ("earning_history"."platform_fee_cents" <= 9007199254740991);--> statement-breakpoint
ALTER TABLE "payout_history" ADD CONSTRAINT "payout_history_amount_cents_max_check" CHECK ("payout_history"."amount_cents" <= 9007199254740991);--> statement-breakpoint
ALTER TABLE "client_spents" ADD CONSTRAINT "client_spents_total_spent_cents_max_check" CHECK ("client_spents"."total_spent_cents" <= 9007199254740991);--> statement-breakpoint
ALTER TABLE "connects_purchase_history" ADD CONSTRAINT "connects_purchase_history_amount_paid_cents_max_check" CHECK ("connects_purchase_history"."amount_paid_cents" <= 9007199254740991);
