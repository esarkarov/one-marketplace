CREATE TABLE "earning_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"freelancer_id" text NOT NULL,
	"contract_id" uuid NOT NULL,
	"milestone_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "earning_history_milestone_id_unique" UNIQUE("milestone_id"),
	CONSTRAINT "earning_history_amount_check" CHECK ("earning_history"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "earning_history" ADD CONSTRAINT "earning_history_freelancer_id_accounts_auth_id_fk" FOREIGN KEY ("freelancer_id") REFERENCES "public"."accounts"("auth_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "earning_history" ADD CONSTRAINT "earning_history_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "earning_history" ADD CONSTRAINT "earning_history_milestone_id_contract_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."contract_milestones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "earning_history_freelancer_created_idx" ON "earning_history" USING btree ("freelancer_id","created_at");