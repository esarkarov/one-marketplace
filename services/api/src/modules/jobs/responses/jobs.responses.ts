import { JOB_STATUSES } from "../../../shared/validation/constants/status.constants.js";
import { z } from "zod";
import {
  ErrorBody,
  offsetPage,
  ok,
  requestIdField,
  okNoData,
  BadRequestBody,
} from "../../../shared/responses/api-envelope.responses.js";
import {
  cents,
  isoDateTime,
} from "../../../shared/responses/scalar.responses.js";

const jobPostFields = {
  id: z.uuid(),
  clientId: z.string(),
  title: z.string(),
  description: z.string(),
  expertiseLevel: z.string(),
  expectedDuration: z.string(),
  skills: z.array(z.string()),
  totalBudgetCents: cents,
  milestones: z.array(
    z.strictObject({
      id: z.string(),
      title: z.string(),
      budgetCents: cents,
      dueDate: z.string(),
    }),
  ),
  screeningQuestions: z.array(z.string()).nullable(),
  attachments: z
    .array(
      z.strictObject({
        fileId: z.string(),
        fileName: z.string(),
        fileUrl: z.string(),
        fileType: z.string(),
        fileSize: z.number().int(),
      }),
    )
    .nullable(),
  status: z.enum(JOB_STATUSES),
  publishedAt: isoDateTime.nullable(),
  hiredAt: isoDateTime.nullable(),
  createdAt: isoDateTime.nullable(),
  updatedAt: isoDateTime.nullable(),
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
    jobId: z.uuid(),
    freelancerId: z.string(),
    createdAt: isoDateTime.nullable(),
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
  200: okNoData,
  403: ErrorBody,
  404: ErrorBody,
};

export const jobsGetResponses = {
  200: ok(JobsPostWithStats),
  403: ErrorBody,
  404: ErrorBody,
};

const JobLockedBody = z.strictObject({
  success: z.literal(false),
  message: z.string(),
  code: z.literal("JOB_LOCKED"),
  requestId: requestIdField,
});

export const jobsUpdateResponses = {
  200: ok(JobsPost),
  400: BadRequestBody,
  403: ErrorBody,
  404: ErrorBody,
  409: JobLockedBody,
};

export const jobsDeleteResponses = {
  200: okNoData,
  403: ErrorBody,
  404: ErrorBody,
  409: JobLockedBody,
};
