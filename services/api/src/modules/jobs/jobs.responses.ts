import { z } from "zod";
import {
  cents,
  ErrorBody,
  isoDateTime,
  offsetPage,
  ok,
  okNoData,
  BadRequestBody,
} from "../../utils/response-schemas.js";

const jobPostFields = {
  id: z.uuid(),
  client_id: z.string(),
  title: z.string(),
  description: z.string(),
  expertise_level: z.string(),
  expected_duration: z.string(),
  skills: z.array(z.string()),
  total_budget_cents: cents,
  milestones: z.array(
    z.strictObject({
      id: z.string(),
      title: z.string(),
      budgetCents: cents,
      dueDate: z.string(),
    }),
  ),
  screening_questions: z.array(z.string()).nullable(),
  attachments: z
    .array(
      z.strictObject({
        fileId: z.string(),
        fileName: z.string(),
        fileUrl: z.string(),
        fileType: z.string(),
        fileSize: z.number(),
      }),
    )
    .nullable(),
  status: z.string(),
  published_at: isoDateTime.nullable(),
  hired_at: isoDateTime.nullable(),
  created_at: isoDateTime.nullable(),
  updated_at: isoDateTime.nullable(),
};

const JobsPost = z.strictObject(jobPostFields).meta({ id: "JobsPost" });

const JobsPostWithStats = z
  .strictObject({
    ...jobPostFields,
    proposalCount: z.number().int(),
    shortlistCount: z.number().int(),
    hireCount: z.number().int(),
  })
  .meta({ id: "JobsPostWithStats" });

const JobsSavedLink = z
  .strictObject({
    id: z.uuid(),
    job_id: z.uuid(),
    freelancer_id: z.string(),
    created_at: isoDateTime.nullable(),
  })
  .meta({ id: "JobsSavedLink" });

const JobsSavedPost = z
  .strictObject({
    ...jobPostFields,
    savedAt: isoDateTime.nullable(),
    companyName: z.string(),
    paymentVerified: z.boolean(),
    proposalCount: z.number().int(),
  })
  .meta({ id: "JobsSavedPost" });

const JobsPublicSummary = z
  .strictObject({
    id: z.uuid(),
    title: z.string(),
    description: z.string(),
    skills: z.array(z.string()),
    totalBudgetCents: cents,
    expectedDuration: z.string(),
    expertiseLevel: z.string(),
    publishedAt: isoDateTime.nullable(),
    companyName: z.string(),
    clientLocation: z.string().nullable(),
    paymentVerified: z.boolean(),
    clientRating: z.number(),
    clientTotalSpentCents: cents,
    proposalCount: z.number().int(),
  })
  .meta({ id: "JobsPublicSummary" });

export const jobsCreateResponses = {
  201: ok(JobsPost),
  400: BadRequestBody,
  403: ErrorBody,
};

export const jobsListResponses = {
  200: ok(z.array(JobsPostWithStats)),
  403: ErrorBody,
};

export const jobsPublicResponses = {
  200: ok(offsetPage(JobsPublicSummary)),
};

export const jobsSavedListResponses = {
  200: ok(z.array(JobsSavedPost)),
  403: ErrorBody,
};

export const jobsSaveResponses = {
  201: ok(JobsSavedLink),
  403: ErrorBody,
  404: ErrorBody,
};

export const jobsUnsaveResponses = {
  200: ok(JobsSavedLink),
  403: ErrorBody,
  404: ErrorBody,
};

export const jobsGetResponses = {
  200: ok(JobsPostWithStats.nullable()),
  403: ErrorBody,
};

export const jobsUpdateResponses = {
  200: ok(JobsPost),
  400: BadRequestBody,
  403: ErrorBody,
  404: ErrorBody,
};

export const jobsDeleteResponses = {
  200: okNoData,
  403: ErrorBody,
  404: ErrorBody,
};
