ALTER TABLE "job_posts" DROP CONSTRAINT "job_posts_client_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "job_posts" ALTER COLUMN "client_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "job_posts" ADD CONSTRAINT "job_posts_client_id_accounts_auth_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."accounts"("auth_id") ON DELETE cascade ON UPDATE no action;