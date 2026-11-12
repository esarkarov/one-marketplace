import { z } from "zod";
import {
  authRoleShape,
  uuidParam,
} from "../../shared/validation/common-schemas.js";
import { PROPOSAL_LIMITS } from "../../shared/validation/validation-limits.js";

export const proposalIdParamsSchema = z.strictObject({
  proposalId: uuidParam("Proposal"),
});

export const roleOnlyQuerySchema = z.strictObject({ ...authRoleShape });

export const listProposalsQuerySchema = z.strictObject({
  ...authRoleShape,
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
