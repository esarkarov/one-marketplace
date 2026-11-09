CREATE TABLE "connects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"freelancer_id" text NOT NULL,
	"connects" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "connects_freelancer_id_unique" UNIQUE("freelancer_id")
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
ALTER TABLE "connects" ADD CONSTRAINT "connects_freelancer_id_freelancer_metadata_auth_id_fk" FOREIGN KEY ("freelancer_id") REFERENCES "public"."freelancer_metadata"("auth_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connects_history" ADD CONSTRAINT "connects_history_connects_id_connects_id_fk" FOREIGN KEY ("connects_id") REFERENCES "public"."connects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connects_purchase_history" ADD CONSTRAINT "connects_purchase_history_connects_id_connects_id_fk" FOREIGN KEY ("connects_id") REFERENCES "public"."connects"("id") ON DELETE cascade ON UPDATE no action;