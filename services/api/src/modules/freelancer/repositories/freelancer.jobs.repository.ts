import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";
import type { DbExecutor } from "@/database/database.types.js";
import { fetchSize } from "@/shared/validation/utils/pagination.utils.js";
import { accounts } from "@/modules/auth/models/auth.model.js";
import { client_metadata } from "@/modules/client/models/client.model.js";
import {
  client_spents,
  contracts,
} from "@/modules/contracts/models/contracts.model.js";
import { job_posts } from "@/modules/jobs/models/jobs.model.js";
import { proposals } from "@/modules/proposals/models/proposals.model.js";

export const listPublishedJobsWithClient = (executor: DbExecutor) =>
  executor
    .select({
      job: job_posts,
      clientAccountId: accounts.id,
      companyName: client_metadata.company_name,
      clientCountry: client_metadata.country,
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
    .orderBy(desc(job_posts.published_at), desc(job_posts.id));

export interface RecentJobFeedFilters {
  levels?: string[];
  durations?: string[];
  minBudgetCents?: number;
  maxBudgetCents?: number;
  minProposals?: number;
  maxProposals?: number;
  paymentVerified?: boolean;
}

const proposalTotalSql = sql`(select count(*) from ${proposals} where ${proposals.job_id} = ${job_posts.id})`;

const recentFeedConditions = (filters: RecentJobFeedFilters) => {
  const conditions: SQL[] = [eq(job_posts.status, "PUBLISHED")];
  if (filters.levels?.length) {
    conditions.push(inArray(job_posts.expertise_level, filters.levels));
  }
  if (filters.durations?.length) {
    conditions.push(inArray(job_posts.expected_duration, filters.durations));
  }
  if (filters.minBudgetCents !== undefined) {
    conditions.push(gte(job_posts.total_budget_cents, filters.minBudgetCents));
  }
  if (filters.maxBudgetCents !== undefined) {
    conditions.push(lte(job_posts.total_budget_cents, filters.maxBudgetCents));
  }
  if (filters.paymentVerified) {
    conditions.push(sql`${accounts.paymentMethodVerified} is true`);
  }
  if (filters.minProposals !== undefined) {
    conditions.push(
      sql`${proposalTotalSql} >= ${filters.minProposals}::bigint`,
    );
  }
  if (filters.maxProposals !== undefined) {
    conditions.push(
      sql`${proposalTotalSql} <= ${filters.maxProposals}::bigint`,
    );
  }
  return and(...conditions);
};

export const listRecentJobIds = async (
  executor: DbExecutor,
  filters: RecentJobFeedFilters,
  { limit, offset }: { limit: number; offset: number },
) => {
  const rows = await executor
    .select({ id: job_posts.id })
    .from(job_posts)
    .innerJoin(accounts, eq(job_posts.client_id, accounts.auth_id))
    .innerJoin(
      client_metadata,
      eq(job_posts.client_id, client_metadata.auth_id),
    )
    .where(recentFeedConditions(filters))
    .orderBy(desc(job_posts.published_at), desc(job_posts.id))
    .limit(fetchSize(limit))
    .offset(offset);
  return rows.map((row) => row.id);
};

export const listRecentJobsByIds = async (
  executor: DbExecutor,
  jobIds: string[],
) => {
  if (jobIds.length === 0) return [];
  return executor
    .select({
      job: job_posts,
      clientAccountId: accounts.id,
      companyName: client_metadata.company_name,
      clientCountry: client_metadata.country,
      paymentVerified: accounts.paymentMethodVerified,
      totalSpentCents: client_spents.total_spent_cents,
      clientRating: client_spents.rating,
      clientReviewCount: client_spents.review_count,
      proposalCount: sql<number>`${proposalTotalSql}::int`,
      hireCount: sql<number>`(select count(*) from ${contracts} where ${contracts.job_id} = ${job_posts.id} and ${contracts.status} in ('ACTIVE', 'COMPLETED'))::int`,
    })
    .from(job_posts)
    .innerJoin(accounts, eq(job_posts.client_id, accounts.auth_id))
    .innerJoin(
      client_metadata,
      eq(job_posts.client_id, client_metadata.auth_id),
    )
    .leftJoin(client_spents, eq(job_posts.client_id, client_spents.client_id))
    .where(inArray(job_posts.id, jobIds))
    .orderBy(desc(job_posts.published_at), desc(job_posts.id));
};

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
      clientAccountId: accounts.id,
      companyName: client_metadata.company_name,
      companyDescription: client_metadata.company_description,
      clientCountry: client_metadata.country,
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
