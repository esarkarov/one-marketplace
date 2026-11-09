CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid,
	"provider" text DEFAULT 'daily' NOT NULL,
	"provider_room_name" text NOT NULL,
	"join_url" text NOT NULL,
	"started_by_account_id" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meetings_status_check" CHECK ("meetings"."status" IN ('ACTIVE', 'ENDED'))
);
--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_started_by_account_id_accounts_auth_id_fk" FOREIGN KEY ("started_by_account_id") REFERENCES "public"."accounts"("auth_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meetings_provider_room_name_unique" ON "meetings" USING btree ("provider_room_name");--> statement-breakpoint
CREATE INDEX "meetings_conversation_status_idx" ON "meetings" USING btree ("conversation_id","status");