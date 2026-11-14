import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { DbExecutor } from "../../database/db-executor.js";
import { accounts } from "../auth/auth.schema.js";
import { agency_earning } from "../contracts/contracts.schema.js";
import { freelancer_metadata } from "../freelancer/freelancer.schema.js";
import { agency_members, agency_metadata } from "./agency.schema.js";

export interface AgencySearchCriteria {
  specialty?: string;
  sizes?: string[];
  verifiedOnly?: boolean;
  maxRateCents?: number;
  sort?: "recommended" | "rating" | "projects" | "rate-low";
}

export const searchAgencyRows = (
  executor: DbExecutor,
  criteria: AgencySearchCriteria,
  page: { limit: number; offset: number },
) => {
  const memberCountExpr = sql<number>`(
    SELECT count(*) FROM ${agency_members}
    WHERE ${agency_members.agency_id} = ${agency_metadata.id}
  )`;
  const minHourlyRateExpr = sql<string | null>`(
    SELECT min(${freelancer_metadata.hourly_rate_cents}) FROM ${agency_members}
    INNER JOIN ${freelancer_metadata}
      ON ${freelancer_metadata.auth_id} = ${agency_members.freelancer_id}
    WHERE ${agency_members.agency_id} = ${agency_metadata.id}
  )`;

  const conditions = [eq(agency_metadata.is_onboarded, true)];
  if (criteria.specialty) {
    conditions.push(eq(agency_metadata.specialty, criteria.specialty));
  }
  if (criteria.sizes?.length) {
    conditions.push(inArray(agency_metadata.size, criteria.sizes));
  }
  if (criteria.verifiedOnly) {
    conditions.push(eq(accounts.identityVerified, true));
  }
  if (criteria.maxRateCents) {
    conditions.push(sql`${minHourlyRateExpr} <= ${criteria.maxRateCents}`);
  }

  const orderBy = (() => {
    switch (criteria.sort) {
      case "rating":
        return desc(agency_earning.rating);
      case "projects":
        return desc(agency_earning.completed_jobs);
      case "rate-low":
        return asc(minHourlyRateExpr);
      default:
        return desc(
          sql`${agency_earning.rating} * ${agency_earning.job_success_score}`,
        );
    }
  })();

  return executor
    .select({
      id: agency_metadata.id,
      name: agency_metadata.name,
      professionalTitle: agency_metadata.professional_title,
      specialty: agency_metadata.specialty,
      overview: agency_metadata.overview,
      size: agency_metadata.size,
      tags: agency_metadata.tags,
      avatarImage: agency_metadata.avatar_image,
      identityVerified: accounts.identityVerified,
      ownerCity: freelancer_metadata.city,
      ownerCountry: freelancer_metadata.country,
      rating: agency_earning.rating,
      jobSuccessScore: agency_earning.job_success_score,
      completedJobs: agency_earning.completed_jobs,
      reviewCount: agency_earning.review_count,
      memberCount: memberCountExpr,
      minHourlyRateCents: minHourlyRateExpr,
    })
    .from(agency_metadata)
    .innerJoin(accounts, eq(accounts.auth_id, agency_metadata.owner_id))
    .leftJoin(
      freelancer_metadata,
      eq(freelancer_metadata.auth_id, agency_metadata.owner_id),
    )
    .leftJoin(agency_earning, eq(agency_earning.agency_id, agency_metadata.id))
    .where(and(...conditions))
    .orderBy(orderBy)
    .limit(page.limit)
    .offset(page.offset);
};
