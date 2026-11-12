import { z } from "zod";
import {
  cents,
  ErrorBody,
  isoDateTime,
  ok,
  BadRequestBody,
} from "../../shared/validation/response-schemas.js";

const ProposalsRow = z
  .strictObject({
    id: z.uuid(),
    job_id: z.uuid(),
    sender_id: z.string(),
    sender_type: z.string(),
    cover_letter: z.string(),
    bid_amount_cents: cents,
    duration: z.string(),
    screening_answers: z.array(
      z.strictObject({ question: z.string(), answer: z.string() }),
    ),
    status: z.string(),
    is_shortlisted: z.boolean(),
    created_at: isoDateTime.nullable(),
    updated_at: isoDateTime.nullable(),
  })
  .meta({ id: "ProposalsRow" });

const ProposalsSubmitted = z
  .strictObject({
    proposal: ProposalsRow,
    connects: z.number().int(),
    clientId: z.string(),
    jobTitle: z.string(),
  })
  .meta({ id: "ProposalsSubmitted" });

const ProposalsMetadata = z
  .strictObject({
    proposals: z.array(
      z.strictObject({
        jobId: z.uuid(),
        status: z.string(),
        submittedAt: isoDateTime.nullable(),
      }),
    ),
    counts: z.strictObject({
      total: z.number().int(),
      active: z.number().int(),
      viewed: z.number().int(),
      interviewed: z.number().int(),
    }),
  })
  .meta({ id: "ProposalsMetadata" });

const ProposalsFreelancerItem = z
  .strictObject({
    id: z.uuid(),
    jobId: z.uuid(),
    title: z.string(),
    company: z.string().nullable(),
    status: z.string(),
    submittedAt: isoDateTime.nullable(),
    budgetCents: cents,
    bidAmountCents: cents,
    duration: z.string(),
    coverLetter: z.string(),
    skills: z.array(z.string()),
  })
  .meta({ id: "ProposalsFreelancerItem" });

const clientItemFields = {
  id: z.uuid(),
  conversationId: z.uuid().nullable(),
  contractId: z.uuid().nullable(),
  contractStatus: z.string().nullable(),
  freelancerId: z.uuid().nullable(),
  verified: z.boolean().nullable(),
  professionalTitle: z.string().nullable(),
  country: z.string().nullable(),
  city: z.string().nullable(),
  skills: z.array(z.string()).nullable(),
  coverLetter: z.string(),
  bidAmountCents: cents,
  duration: z.string(),
  screeningAnswers: z.array(
    z.strictObject({ question: z.string(), answer: z.string() }),
  ),
  status: z.string(),
  isShortlisted: z.boolean(),
  submittedAt: isoDateTime.nullable(),
  jobSuccessScore: z.number(),
  rating: z.number(),
  completedJobs: z.number().int(),
  senderId: z.string(),
  senderType: z.string(),
};

const ProposalsClientFreelancerItem = z.strictObject({
  ...clientItemFields,
  senderName: z.string().nullable(),
  avatar: z.string().nullable(),
});

const ProposalsClientFreelancerFallbackItem = z.strictObject({
  ...clientItemFields,
  senderName: z.null(),
  avatarUrl: z.null(),
});

const ProposalsClientAgencyItem = z.strictObject({
  ...clientItemFields,
  senderName: z.string(),
  avatar: z.string().nullable(),
  memberCount: z.number().int(),
  agencyTags: z.array(z.string()),
});

const ProposalsClientItem = z
  .union([
    ProposalsClientAgencyItem,
    ProposalsClientFreelancerItem,
    ProposalsClientFreelancerFallbackItem,
  ])
  .meta({ id: "ProposalsClientItem" });

const ProposalsShortlisted = z
  .strictObject({ id: z.uuid(), isShortlisted: z.boolean() })
  .meta({ id: "ProposalsShortlisted" });

const ProposalsViewed = z
  .strictObject({
    id: z.uuid(),
    senderId: z.string(),
    senderType: z.string(),
    status: z.string(),
    jobTitle: z.string(),
    changed: z.boolean(),
  })
  .meta({ id: "ProposalsViewed" });

const ProposalsInterview = z
  .strictObject({
    conversationId: z.uuid(),
    proposalId: z.uuid(),
    senderType: z.string(),
    freelancerId: z.string(),
    agencyId: z.uuid().nullable(),
    jobTitle: z.string(),
    connects: z.number().int(),
  })
  .meta({ id: "ProposalsInterview" });

export const proposalsListResponses = {
  200: ok(
    z.union([z.array(ProposalsClientItem), z.array(ProposalsFreelancerItem)]),
  ),
  403: ErrorBody,
};

export const proposalsMetadataResponses = {
  200: ok(ProposalsMetadata),
  403: ErrorBody,
};

export const proposalsCreateResponses = {
  201: ok(ProposalsSubmitted),
  400: BadRequestBody,
  403: ErrorBody,
  404: ErrorBody,
  409: ErrorBody,
};

export const proposalsStatusResponses = {
  200: ok(z.union([ProposalsShortlisted, ProposalsViewed])),
  403: ErrorBody,
  404: ErrorBody,
};

export const proposalsInterviewResponses = {
  201: ok(ProposalsInterview),
  403: ErrorBody,
  404: ErrorBody,
  409: ErrorBody,
};
