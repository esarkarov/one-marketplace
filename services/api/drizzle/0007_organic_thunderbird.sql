CREATE INDEX "contracts_job_status_idx" ON "contracts" USING btree ("job_id","status");--> statement-breakpoint
CREATE INDEX "job_posts_published_feed_idx" ON "job_posts" USING btree ("published_at" DESC NULLS FIRST,"id" DESC NULLS FIRST) WHERE "job_posts"."status" = 'PUBLISHED';--> statement-breakpoint
CREATE INDEX "proposals_job_id_idx" ON "proposals" USING btree ("job_id");