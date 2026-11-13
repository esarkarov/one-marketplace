import { eq, sql } from "drizzle-orm";
import type { DbExecutor } from "../../database/db-executor.js";
import { job_posts } from "./jobs.schema.js";

type JobMilestone = (typeof job_posts.$inferSelect)["milestones"][number];

export const appendJobMilestone = async (
  executor: DbExecutor,
  jobId: string,
  milestone: JobMilestone,
  now: Date,
) => {
  const [currentJob] = await executor
    .select({ milestones: job_posts.milestones })
    .from(job_posts)
    .where(eq(job_posts.id, jobId));
  await executor
    .update(job_posts)
    .set({
      milestones: [...(currentJob?.milestones ?? []), milestone],
      total_budget_cents: sql`${job_posts.total_budget_cents} + ${milestone.budgetCents}`,
      updated_at: now,
    })
    .where(eq(job_posts.id, jobId));
};
