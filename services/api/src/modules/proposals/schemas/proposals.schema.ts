import { z } from "zod";
import type { RequestSchemas } from "../../../middleware/types/validate.types.js";
import { moneyCents } from "../../../shared/money/money.js";
import {
  authRoleShape,
  boundedText,
  uuidParam,
} from "../../../shared/validation/schemas/common.schema.js";
import {
  paginationShape,
  roleListQuerySchema,
} from "../../../shared/validation/schemas/pagination.schema.js";
import { PROPOSAL_LIMITS } from "../constants/proposals.constants.js";

const MAX_BID_CENTS = 100_000_000;

export const submitProposalBodySchema = z.strictObject(
  {
    ...authRoleShape,
    jobId: uuidParam("Job post"),
    coverLetter: boundedText("Cover letter", {
      min: PROPOSAL_LIMITS.coverLetterMin,
      max: PROPOSAL_LIMITS.coverLetterMax,
    }),
    bidAmountCents: moneyCents
      .min(1, { error: "Enter a valid bid amount." })
      .max(MAX_BID_CENTS, { error: "Enter a valid bid amount." }),
    duration: boundedText("Delivery duration", {
      max: PROPOSAL_LIMITS.durationMax,
    }),
    screeningAnswers: z
      .array(
        boundedText("Screening answer", {
          min: 0,
          max: PROPOSAL_LIMITS.screeningAnswerMaxLength,
        }),
        { error: "Screening answers must be an array." },
      )
      .max(PROPOSAL_LIMITS.screeningAnswersMaxItems, {
        error: `At most ${PROPOSAL_LIMITS.screeningAnswersMaxItems} screening answers are allowed.`,
      })
      .optional(),
  },
  { error: "Request body must be an object." },
);

export const proposalIdParamsSchema = z.strictObject({
  proposalId: uuidParam("Proposal"),
});

export const roleOnlyQuerySchema = z.strictObject({ ...authRoleShape });

export const listProposalsQuerySchema = z.strictObject({
  ...authRoleShape,
  ...paginationShape,
  jobId: uuidParam("Job post").optional(),
});

export const updateProposalStatusBodySchema = z.preprocess(
  (value) => value ?? {},
  z.strictObject({
    ...authRoleShape,
    isShortlisted: z
      .boolean({ error: "Shortlist flag must be true or false." })
      .optional(),
  }),
);

export const interviewProposalBodySchema = z.strictObject({
  ...authRoleShape,
  message: z
    .string({ error: "Interview message is required." })
    .trim()
    .min(1, { error: "Interview message is required." })
    .max(PROPOSAL_LIMITS.interviewMessageMax, {
      error: `Interview message cannot exceed ${PROPOSAL_LIMITS.interviewMessageMax.toLocaleString("en-US")} characters.`,
    }),
});

export const createProposalRequest = {
  query: roleOnlyQuerySchema,
  body: submitProposalBodySchema,
} satisfies RequestSchemas;

export const proposalMetadataRequest = {
  query: roleListQuerySchema,
} satisfies RequestSchemas;

export const listProposalsRequest = {
  query: listProposalsQuerySchema,
} satisfies RequestSchemas;

export const updateProposalStatusRequest = {
  params: proposalIdParamsSchema,
  query: roleOnlyQuerySchema,
  body: updateProposalStatusBodySchema,
} satisfies RequestSchemas;

export const interviewProposalRequest = {
  params: proposalIdParamsSchema,
  query: roleOnlyQuerySchema,
  body: interviewProposalBodySchema,
} satisfies RequestSchemas;

export const submitAgencyProposalRequest = {
  query: authRoleShape,
  body: submitProposalBodySchema,
} satisfies RequestSchemas;

export const agencyProposalMetadataRequest = {
  query: roleListQuerySchema,
} satisfies RequestSchemas;

export const agencyProposalsRequest = {
  query: roleListQuerySchema,
} satisfies RequestSchemas;
