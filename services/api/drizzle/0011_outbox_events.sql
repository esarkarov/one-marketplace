CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"traceparent" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "outbox_events_event_id_unique" UNIQUE("event_id"),
	CONSTRAINT "outbox_events_status_check" CHECK ("outbox_events"."status" IN ('PENDING', 'PUBLISHING', 'PUBLISHED', 'DEAD'))
);
--> statement-breakpoint
CREATE INDEX "outbox_events_due_idx" ON "outbox_events" USING btree ("next_attempt_at") WHERE "outbox_events"."status" IN ('PENDING', 'PUBLISHING');--> statement-breakpoint
CREATE INDEX "outbox_events_status_published_idx" ON "outbox_events" USING btree ("status","published_at");