CREATE TYPE "public"."contract_milestone_status" AS ENUM('PENDING', 'ACTIVE', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."contract_status" AS ENUM('PENDING', 'ACTIVE', 'COMPLETED');--> statement-breakpoint
CREATE TABLE "contract_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"title" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"due_date" date NOT NULL,
	"position" integer NOT NULL,
	"status" "contract_milestone_status" DEFAULT 'PENDING' NOT NULL,
	"payment_requested_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_milestones_amount_check" CHECK ("contract_milestones"."amount" > 0),
	CONSTRAINT "contract_milestones_position_check" CHECK ("contract_milestones"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"freelancer_id" text NOT NULL,
	"title" text NOT NULL,
	"total_amount" numeric(12, 2) NOT NULL,
	"status" "contract_status" DEFAULT 'PENDING' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contracts_total_amount_check" CHECK ("contracts"."total_amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "contract_milestones" ADD CONSTRAINT "contract_milestones_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_job_id_job_posts_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job_posts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_client_id_accounts_auth_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."accounts"("auth_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_freelancer_id_accounts_auth_id_fk" FOREIGN KEY ("freelancer_id") REFERENCES "public"."accounts"("auth_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contract_milestones_contract_position_unique" ON "contract_milestones" USING btree ("contract_id","position");--> statement-breakpoint
CREATE INDEX "contract_milestones_contract_status_idx" ON "contract_milestones" USING btree ("contract_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "contracts_proposal_id_unique" ON "contracts" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX "contracts_client_status_idx" ON "contracts" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "contracts_freelancer_status_idx" ON "contracts" USING btree ("freelancer_id","status");