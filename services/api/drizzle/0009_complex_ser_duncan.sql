CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" text NOT NULL,
	"recipient_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"link" text,
	"metadata" jsonb,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "notifications_event_id_unique" UNIQUE("event_id")
);
