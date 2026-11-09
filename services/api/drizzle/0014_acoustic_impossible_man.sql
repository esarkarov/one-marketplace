CREATE TABLE "conversation_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"participant_type" text NOT NULL,
	"last_read_message_id" uuid,
	"last_read_at" timestamp with time zone,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_active_at" timestamp with time zone,
	CONSTRAINT "conversation_participants_unread_count_check" CHECK ("conversation_participants"."unread_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid,
	"proposal_id" uuid,
	"context_key" text NOT NULL,
	"last_message_id" uuid,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"file_url" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"attachment_type" text NOT NULL,
	"is_available" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_attachments_file_size_check" CHECK ("message_attachments"."file_size" >= 0)
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_id" text,
	"message_type" text DEFAULT 'USER' NOT NULL,
	"body" text,
	"event_type" text,
	"event_payload" jsonb,
	"reply_to_message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_content_check" CHECK ("messages"."message_type" = 'USER' OR ("messages"."message_type" = 'SYSTEM_EVENT' AND "messages"."event_type" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_account_id_accounts_auth_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("auth_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_last_read_message_id_messages_id_fk" FOREIGN KEY ("last_read_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_job_id_job_posts_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_last_message_id_messages_id_fk" FOREIGN KEY ("last_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_accounts_auth_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."accounts"("auth_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_reply_to_message_id_messages_id_fk" FOREIGN KEY ("reply_to_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_participants_conversation_account_unique" ON "conversation_participants" USING btree ("conversation_id","account_id");--> statement-breakpoint
CREATE INDEX "conversation_participants_account_conversation_idx" ON "conversation_participants" USING btree ("account_id","conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_context_key_unique" ON "conversations" USING btree ("context_key");--> statement-breakpoint
CREATE INDEX "conversations_last_message_at_idx" ON "conversations" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX "conversations_job_id_idx" ON "conversations" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "conversations_proposal_id_idx" ON "conversations" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX "message_attachments_message_created_idx" ON "message_attachments" USING btree ("message_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_conversation_created_id_idx" ON "messages" USING btree ("conversation_id","created_at","id");--> statement-breakpoint
CREATE INDEX "messages_reply_to_message_id_idx" ON "messages" USING btree ("reply_to_message_id");