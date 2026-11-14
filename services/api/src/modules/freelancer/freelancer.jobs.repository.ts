import { and, count, desc, eq, inArray } from "drizzle-orm";
import type { DbExecutor } from "../../database/db-executor.js";
import { accounts } from "../auth/auth.schema.js";
import { client_metadata } from "../client/client.schema.js";
import { client_spents, contracts } from "../contracts/contracts.schema.js";
import { job_posts } from "../jobs/jobs.schema.js";
import { proposals } from "../proposals/proposals.schema.js";

export const listPublishedJobsWithClient = (executor: DbExecutor) =>
  executor
    .select({
      job: job_posts,
      companyName: client_metadata.company_name,
      paymentVerified: accounts.paymentMethodVerified,
      totalSpentCents: client_spents.total_spent_cents,
      clientRating: client_spents.rating,
      clientReviewCount: client_spents.review_count,
    })
    .from(job_posts)
    .innerJoin(accounts, eq(job_posts.client_id, accounts.auth_id))
    .innerJoin(
      client_metadata,
      eq(job_posts.client_id, client_metadata.auth_id),
    )
    .leftJoin(client_spents, eq(job_posts.client_id, client_spents.client_id))
    .where(eq(job_posts.status, "PUBLISHED"))
    .orderBy(desc(job_posts.published_at));

export const countProposalsPerJob = (executor: DbExecutor) =>
  executor
    .select({ jobId: proposals.job_id, count: count(proposals.id) })
    .from(proposals)
    .groupBy(proposals.job_id);

export const countHiresPerJob = (executor: DbExecutor) =>
  executor
    .select({ jobId: contracts.job_id, count: count(contracts.id) })
    .from(contracts)
    .where(inArray(contracts.status, ["ACTIVE", "COMPLETED"]))
    .groupBy(contracts.job_id);

export const findPublishedJobDetail = async (
  executor: DbExecutor,
  jobId: string,
) => {
  const [result] = await executor
    .select({
      job: job_posts,
      companyName: client_metadata.company_name,
      companyDescription: client_metadata.company_description,
      paymentVerified: accounts.paymentMethodVerified,
      clientJoinedAt: accounts.created_at,
      totalSpentCents: client_spents.total_spent_cents,
      clientRating: client_spents.rating,
      clientReviewCount: client_spents.review_count,
    })
    .from(job_posts)
    .innerJoin(accounts, eq(job_posts.client_id, accounts.auth_id))
    .innerJoin(
      client_metadata,
      eq(job_posts.client_id, client_metadata.auth_id),
    )
    .leftJoin(client_spents, eq(job_posts.client_id, client_spents.client_id))
    .where(and(eq(job_posts.id, jobId), eq(job_posts.status, "PUBLISHED")))
    .limit(1);
  return result;
};

export const countProposalsForJob = async (
  executor: DbExecutor,
  jobId: string,
) => {
  const [proposalTotal] = await executor
    .select({ count: count(proposals.id) })
    .from(proposals)
    .where(eq(proposals.job_id, jobId));
  return proposalTotal;
};

export const countHiresForJob = async (executor: DbExecutor, jobId: string) => {
  const [hireTotal] = await executor
    .select({ count: count(contracts.id) })
    .from(contracts)
    .where(
      and(
        eq(contracts.job_id, jobId),
        inArray(contracts.status, ["ACTIVE", "COMPLETED"]),
      ),
    );
  return hireTotal;
};
