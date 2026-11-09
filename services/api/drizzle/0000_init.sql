CREATE TYPE "public"."account_role" AS ENUM('FREELANCER', 'CLIENT');--> statement-breakpoint
CREATE TYPE "public"."contract_milestone_status" AS ENUM('PENDING', 'ACTIVE', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."contract_status" AS ENUM('PENDING', 'ACTIVE', 'COMPLETED');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_id" text NOT NULL,
	"email" text NOT NULL,
	"stripe_customer_id" text,
	"stripe_connect_account_id" text,
	"role" "account_role" DEFAULT 'CLIENT' NOT NULL,
	"identityVerified" boolean DEFAULT false,
	"paymentMethodVerified" boolean DEFAULT false,
	"isOnboardingComplete" boolean DEFAULT false,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	CONSTRAINT "accounts_auth_id_unique" UNIQUE("auth_id"),
	CONSTRAINT "accounts_stripe_customer_id_unique" UNIQUE("stripe_customer_id"),
	CONSTRAINT "accounts_stripe_connect_account_id_unique" UNIQUE("stripe_connect_account_id")
);
--> statement-breakpoint
CREATE TABLE "agency_earning" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"total_earning" numeric(12, 2) DEFAULT '0' NOT NULL,
	"completed_jobs" integer DEFAULT 0 NOT NULL,
	"ongoing_jobs" integer DEFAULT 0 NOT NULL,
	"review_count" integer DEFAULT 0 NOT NULL,
	"job_success_score" numeric(5, 2) DEFAULT '0' NOT NULL,
	"rating" numeric(3, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agency_earning_agency_id_unique" UNIQUE("agency_id"),
	CONSTRAINT "agency_earning_total_check" CHECK ("agency_earning"."total_earning" >= 0),
	CONSTRAINT "agency_earning_completed_check" CHECK ("agency_earning"."completed_jobs" >= 0),
	CONSTRAINT "agency_earning_ongoing_check" CHECK ("agency_earning"."ongoing_jobs" >= 0),
	CONSTRAINT "agency_earning_reviews_check" CHECK ("agency_earning"."review_count" >= 0),
	CONSTRAINT "agency_earning_success_check" CHECK ("agency_earning"."job_success_score" BETWEEN 0 AND 100),
	CONSTRAINT "agency_earning_rating_check" CHECK ("agency_earning"."rating" BETWEEN 0 AND 5)
);
--> statement-breakpoint
CREATE TABLE "agency_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'Agency member' NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"invited_by" text NOT NULL,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agency_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"freelancer_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agency_members_freelancer_id_unique" UNIQUE("freelancer_id")
);
--> statement-breakpoint
CREATE TABLE "agency_metadata" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"professional_title" text,
	"size" text NOT NULL,
	"specialty" text NOT NULL,
	"website" text,
	"overview" text NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"avatar_image" jsonb,
	"is_onboarded" boolean DEFAULT false NOT NULL,
	"stripe_connect_account_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agency_metadata_owner_id_unique" UNIQUE("owner_id")
);
--> statement-breakpoint
CREATE TABLE "agency_portfolios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"live_url" text,
	"cover_image" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "client_metadata" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_id" text NOT NULL,
	"role" text NOT NULL,
	"company_name" text NOT NULL,
	"company_website" text NOT NULL,
	"company_size" text NOT NULL,
	"industry" text NOT NULL,
	"company_description" text NOT NULL,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	CONSTRAINT "client_metadata_auth_id_unique" UNIQUE("auth_id")
);
--> statement-breakpoint
CREATE TABLE "client_spents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text NOT NULL,
	"total_spent" numeric(12, 2) DEFAULT '0' NOT NULL,
	"completed_contracts" integer DEFAULT 0 NOT NULL,
	"ongoing_contracts" integer DEFAULT 0 NOT NULL,
	"review_count" integer DEFAULT 0 NOT NULL,
	"rating" numeric(3, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_spents_client_id_unique" UNIQUE("client_id"),
	CONSTRAINT "client_spents_total_check" CHECK ("client_spents"."total_spent" >= 0),
	CONSTRAINT "client_spents_completed_check" CHECK ("client_spents"."completed_contracts" >= 0),
	CONSTRAINT "client_spents_ongoing_check" CHECK ("client_spents"."ongoing_contracts" >= 0),
	CONSTRAINT "client_spents_reviews_check" CHECK ("client_spents"."review_count" >= 0),
	CONSTRAINT "client_spents_rating_check" CHECK ("client_spents"."rating" BETWEEN 0 AND 5)
);
--> statement-breakpoint
CREATE TABLE "connects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"freelancer_id" text,
	"agency_id" uuid,
	"connects" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "connects_freelancer_id_unique" UNIQUE("freelancer_id"),
	CONSTRAINT "connects_agency_id_unique" UNIQUE("agency_id"),
	CONSTRAINT "connects_owner_check" CHECK (("connects"."freelancer_id" IS NOT NULL) <> ("connects"."agency_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "connects_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connects_id" uuid NOT NULL,
	"type" text NOT NULL,
	"description" text NOT NULL,
	"amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "connects_purchase_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connects_id" uuid NOT NULL,
	"purchased_connects" integer NOT NULL,
	"amount_paid" numeric NOT NULL,
	"payment_id" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "connects_purchase_history_payment_id_unique" UNIQUE("payment_id")
);
--> statement-breakpoint
CREATE TABLE "contract_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"title" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"due_date" date NOT NULL,
	"position" integer NOT NULL,
	"status" "contract_milestone_status" DEFAULT 'PENDING' NOT NULL,
	"stripe_checkout_session_id" text,
	"stripe_payment_intent_id" text,
	"funded_at" timestamp with time zone,
	"payment_requested_at" timestamp with time zone,
	"submission_message" text,
	"submission_delivery_link" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_milestones_stripe_checkout_session_id_unique" UNIQUE("stripe_checkout_session_id"),
	CONSTRAINT "contract_milestones_stripe_payment_intent_id_unique" UNIQUE("stripe_payment_intent_id"),
	CONSTRAINT "contract_milestones_amount_check" CHECK ("contract_milestones"."amount" > 0),
	CONSTRAINT "contract_milestones_position_check" CHECK ("contract_milestones"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"freelancer_id" text,
	"agency_id" uuid,
	"title" text NOT NULL,
	"total_amount" numeric(12, 2) NOT NULL,
	"status" "contract_status" DEFAULT 'PENDING' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contracts_total_amount_check" CHECK ("contracts"."total_amount" > 0),
	CONSTRAINT "contracts_owner_check" CHECK (("contracts"."freelancer_id" IS NOT NULL) <> ("contracts"."agency_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "conversation_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"account_id" text,
	"agency_id" uuid,
	"participant_type" text NOT NULL,
	"last_read_message_id" uuid,
	"last_read_at" timestamp with time zone,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_active_at" timestamp with time zone,
	CONSTRAINT "conversation_participants_unread_count_check" CHECK ("conversation_participants"."unread_count" >= 0),
	CONSTRAINT "conversation_participants_owner_check" CHECK (("conversation_participants"."account_id" IS NOT NULL) <> ("conversation_participants"."agency_id" IS NOT NULL))
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
CREATE TABLE "earning_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"freelancer_id" text,
	"agency_id" uuid,
	"contract_id" uuid NOT NULL,
	"milestone_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"platform_fee_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "earning_history_milestone_id_unique" UNIQUE("milestone_id"),
	CONSTRAINT "earning_history_amount_check" CHECK ("earning_history"."amount" > 0),
	CONSTRAINT "earning_history_fee_check" CHECK ("earning_history"."platform_fee_amount" >= 0),
	CONSTRAINT "earning_history_owner_check" CHECK (("earning_history"."freelancer_id" IS NOT NULL) <> ("earning_history"."agency_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "freelancer_earning" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"freelancer_id" text NOT NULL,
	"total_earning" numeric(12, 2) DEFAULT '0' NOT NULL,
	"completed_jobs" integer DEFAULT 0 NOT NULL,
	"ongoing_jobs" integer DEFAULT 0 NOT NULL,
	"review_count" integer DEFAULT 0 NOT NULL,
	"job_success_score" numeric(5, 2) DEFAULT '0' NOT NULL,
	"rating" numeric(3, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "freelancer_earning_freelancer_id_unique" UNIQUE("freelancer_id"),
	CONSTRAINT "freelancer_earning_total_check" CHECK ("freelancer_earning"."total_earning" >= 0),
	CONSTRAINT "freelancer_earning_completed_check" CHECK ("freelancer_earning"."completed_jobs" >= 0),
	CONSTRAINT "freelancer_earning_ongoing_check" CHECK ("freelancer_earning"."ongoing_jobs" >= 0),
	CONSTRAINT "freelancer_earning_reviews_check" CHECK ("freelancer_earning"."review_count" >= 0),
	CONSTRAINT "freelancer_earning_success_check" CHECK ("freelancer_earning"."job_success_score" BETWEEN 0 AND 100),
	CONSTRAINT "freelancer_earning_rating_check" CHECK ("freelancer_earning"."rating" BETWEEN 0 AND 5)
);
--> statement-breakpoint
CREATE TABLE "freelancer_metadata" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_id" text NOT NULL,
	"professional_title" text NOT NULL,
	"professional_description" text NOT NULL,
	"hourly_rate" numeric(6, 2) NOT NULL,
	"country" text NOT NULL,
	"city" text NOT NULL,
	"availability_status" text DEFAULT 'AVAILABLE' NOT NULL,
	"weekly_availability" text NOT NULL,
	"experience_level" text NOT NULL,
	"skills" text[] DEFAULT '{}' NOT NULL,
	"languages" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "freelancer_metadata_auth_id_unique" UNIQUE("auth_id")
);
--> statement-breakpoint
CREATE TABLE "freelancer_portfolios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"freelancer_id" uuid NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"live_url" text,
	"cover_image" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "freelancer_saved_job_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"freelancer_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "job_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"expertise_level" text NOT NULL,
	"expected_duration" text NOT NULL,
	"skills" text[] DEFAULT '{}' NOT NULL,
	"total_budget" numeric(9, 2) NOT NULL,
	"milestones" jsonb NOT NULL,
	"screening_questions" text[] DEFAULT '{}',
	"attachments" jsonb DEFAULT '[]'::jsonb,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"published_at" timestamp with time zone,
	"hired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
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
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" text NOT NULL,
	"recipient_id" text,
	"agency_id" uuid,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"link" text,
	"metadata" jsonb,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "notifications_event_id_unique" UNIQUE("event_id"),
	CONSTRAINT "notifications_target_check" CHECK (("notifications"."recipient_id" IS NOT NULL) <> ("notifications"."agency_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "payout_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"freelancer_id" text,
	"agency_id" uuid,
	"earning_history_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"stripe_transfer_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_history_earning_history_id_unique" UNIQUE("earning_history_id"),
	CONSTRAINT "payout_history_stripe_transfer_id_unique" UNIQUE("stripe_transfer_id"),
	CONSTRAINT "payout_history_amount_check" CHECK ("payout_history"."amount" > 0),
	CONSTRAINT "payout_history_owner_check" CHECK (("payout_history"."freelancer_id" IS NOT NULL) <> ("payout_history"."agency_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"sender_id" text NOT NULL,
	"sender_type" text NOT NULL,
	"cover_letter" text NOT NULL,
	"bid_amount" numeric(9, 2) NOT NULL,
	"duration" text NOT NULL,
	"screening_answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'SUBMITTED' NOT NULL,
	"is_shortlisted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"reviewer_id" text NOT NULL,
	"reviewee_id" text NOT NULL,
	"agency_id" uuid,
	"rating" integer NOT NULL,
	"comment" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_rating_check" CHECK ("reviews"."rating" BETWEEN 1 AND 5),
	CONSTRAINT "reviews_different_accounts_check" CHECK ("reviews"."reviewer_id" <> "reviews"."reviewee_id")
);
--> statement-breakpoint
ALTER TABLE "agency_earning" ADD CONSTRAINT "agency_earning_agency_id_agency_metadata_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agency_metadata"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_invitations" ADD CONSTRAINT "agency_invitations_agency_id_agency_metadata_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agency_metadata"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_invitations" ADD CONSTRAINT "agency_invitations_invited_by_accounts_auth_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."accounts"("auth_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_members" ADD CONSTRAINT "agency_members_agency_id_agency_metadata_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agency_metadata"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_members" ADD CONSTRAINT "agency_members_freelancer_id_accounts_auth_id_fk" FOREIGN KEY ("freelancer_id") REFERENCES "public"."accounts"("auth_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_metadata" ADD CONSTRAINT "agency_metadata_owner_id_accounts_auth_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."accounts"("auth_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_portfolios" ADD CONSTRAINT "agency_portfolios_agency_id_agency_metadata_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agency_metadata"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_spents" ADD CONSTRAINT "client_spents_client_id_accounts_auth_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."accounts"("auth_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connects" ADD CONSTRAINT "connects_freelancer_id_freelancer_metadata_auth_id_fk" FOREIGN KEY ("freelancer_id") REFERENCES "public"."freelancer_metadata"("auth_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connects" ADD CONSTRAINT "connects_agency_id_agency_metadata_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agency_metadata"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connects_history" ADD CONSTRAINT "connects_history_connects_id_connects_id_fk" FOREIGN KEY ("connects_id") REFERENCES "public"."connects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connects_purchase_history" ADD CONSTRAINT "connects_purchase_history_connects_id_connects_id_fk" FOREIGN KEY ("connects_id") REFERENCES "public"."connects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_milestones" ADD CONSTRAINT "contract_milestones_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_job_id_job_posts_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job_posts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_client_id_accounts_auth_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."accounts"("auth_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_freelancer_id_accounts_auth_id_fk" FOREIGN KEY ("freelancer_id") REFERENCES "public"."accounts"("auth_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_agency_id_agency_metadata_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agency_metadata"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_account_id_accounts_auth_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("auth_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_agency_id_agency_metadata_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agency_metadata"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_last_read_message_id_messages_id_fk" FOREIGN KEY ("last_read_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_job_id_job_posts_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_last_message_id_messages_id_fk" FOREIGN KEY ("last_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "earning_history" ADD CONSTRAINT "earning_history_freelancer_id_accounts_auth_id_fk" FOREIGN KEY ("freelancer_id") REFERENCES "public"."accounts"("auth_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "earning_history" ADD CONSTRAINT "earning_history_agency_id_agency_metadata_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agency_metadata"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "earning_history" ADD CONSTRAINT "earning_history_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "earning_history" ADD CONSTRAINT "earning_history_milestone_id_contract_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."contract_milestones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freelancer_earning" ADD CONSTRAINT "freelancer_earning_freelancer_id_accounts_auth_id_fk" FOREIGN KEY ("freelancer_id") REFERENCES "public"."accounts"("auth_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freelancer_portfolios" ADD CONSTRAINT "freelancer_portfolios_freelancer_id_freelancer_metadata_id_fk" FOREIGN KEY ("freelancer_id") REFERENCES "public"."freelancer_metadata"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freelancer_saved_job_posts" ADD CONSTRAINT "freelancer_saved_job_posts_job_id_job_posts_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freelancer_saved_job_posts" ADD CONSTRAINT "freelancer_saved_job_posts_freelancer_id_freelancer_metadata_auth_id_fk" FOREIGN KEY ("freelancer_id") REFERENCES "public"."freelancer_metadata"("auth_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_posts" ADD CONSTRAINT "job_posts_client_id_accounts_auth_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."accounts"("auth_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_started_by_account_id_accounts_auth_id_fk" FOREIGN KEY ("started_by_account_id") REFERENCES "public"."accounts"("auth_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_accounts_auth_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."accounts"("auth_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_reply_to_message_id_messages_id_fk" FOREIGN KEY ("reply_to_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_agency_id_agency_metadata_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agency_metadata"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_history" ADD CONSTRAINT "payout_history_freelancer_id_accounts_auth_id_fk" FOREIGN KEY ("freelancer_id") REFERENCES "public"."accounts"("auth_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_history" ADD CONSTRAINT "payout_history_agency_id_agency_metadata_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agency_metadata"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_history" ADD CONSTRAINT "payout_history_earning_history_id_earning_history_id_fk" FOREIGN KEY ("earning_history_id") REFERENCES "public"."earning_history"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_job_id_job_posts_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewer_id_accounts_auth_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."accounts"("auth_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewee_id_accounts_auth_id_fk" FOREIGN KEY ("reviewee_id") REFERENCES "public"."accounts"("auth_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_agency_id_agency_metadata_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agency_metadata"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agency_invitations_email_status_idx" ON "agency_invitations" USING btree ("email","status");--> statement-breakpoint
CREATE INDEX "agency_invitations_agency_status_idx" ON "agency_invitations" USING btree ("agency_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_milestones_contract_position_unique" ON "contract_milestones" USING btree ("contract_id","position");--> statement-breakpoint
CREATE INDEX "contract_milestones_contract_status_idx" ON "contract_milestones" USING btree ("contract_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "contracts_proposal_id_unique" ON "contracts" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX "contracts_client_status_idx" ON "contracts" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "contracts_freelancer_status_idx" ON "contracts" USING btree ("freelancer_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_participants_conversation_account_unique" ON "conversation_participants" USING btree ("conversation_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_participants_conversation_agency_unique" ON "conversation_participants" USING btree ("conversation_id","agency_id");--> statement-breakpoint
CREATE INDEX "conversation_participants_account_conversation_idx" ON "conversation_participants" USING btree ("account_id","conversation_id");--> statement-breakpoint
CREATE INDEX "conversation_participants_agency_conversation_idx" ON "conversation_participants" USING btree ("agency_id","conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_context_key_unique" ON "conversations" USING btree ("context_key");--> statement-breakpoint
CREATE INDEX "conversations_last_message_at_idx" ON "conversations" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX "conversations_job_id_idx" ON "conversations" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "conversations_proposal_id_idx" ON "conversations" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX "earning_history_freelancer_created_idx" ON "earning_history" USING btree ("freelancer_id","created_at");--> statement-breakpoint
CREATE INDEX "earning_history_agency_created_idx" ON "earning_history" USING btree ("agency_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "freelancer_saved_job_posts_freelancer_job_unique" ON "freelancer_saved_job_posts" USING btree ("freelancer_id","job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meetings_provider_room_name_unique" ON "meetings" USING btree ("provider_room_name");--> statement-breakpoint
CREATE INDEX "meetings_conversation_status_idx" ON "meetings" USING btree ("conversation_id","status");--> statement-breakpoint
CREATE INDEX "message_attachments_message_created_idx" ON "message_attachments" USING btree ("message_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_conversation_created_id_idx" ON "messages" USING btree ("conversation_id","created_at","id");--> statement-breakpoint
CREATE INDEX "messages_reply_to_message_id_idx" ON "messages" USING btree ("reply_to_message_id");--> statement-breakpoint
CREATE INDEX "payout_history_freelancer_created_idx" ON "payout_history" USING btree ("freelancer_id","created_at");--> statement-breakpoint
CREATE INDEX "payout_history_agency_created_idx" ON "payout_history" USING btree ("agency_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "proposal_sender_job_unique" ON "proposals" USING btree ("sender_id","job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_contract_reviewer_unique" ON "reviews" USING btree ("contract_id","reviewer_id");--> statement-breakpoint
CREATE INDEX "reviews_reviewee_created_idx" ON "reviews" USING btree ("reviewee_id","created_at");--> statement-breakpoint
CREATE INDEX "reviews_agency_created_idx" ON "reviews" USING btree ("agency_id","created_at");