import { z } from "zod";
import {
  authRoleShape,
  boundedText,
  scopeField,
  uuidParam,
} from "../../utils/common-schemas.js";
import { MAX_MONEY_CENTS } from "../../utils/money.js";
import { CONTRACT_LIMITS } from "../../utils/validation-limits.js";

export const MIN_MILESTONE_CENTS = 1000;

const MILESTONE_AMOUNT_ERROR =
  "Milestone amount must be at least $10, in whole cents.";

const scope = scopeField(["agency", "default"] as const).optional();

export const contractIdParamsSchema = z.strictObject({
  contractId: uuidParam("Contract"),
});

export const milestoneParamsSchema = z.strictObject({
  contractId: uuidParam("Contract"),
  milestoneId: uuidParam("Milestone"),
});

export const roleOnlyQuerySchema = z.strictObject({ ...authRoleShape });

export const scopeQuerySchema = z.strictObject({ ...authRoleShape, scope });

export const contractCheckoutBodySchema = z.strictObject({
  ...authRoleShape,
  proposalId: uuidParam("Proposal"),
});

export const milestoneCheckoutBodySchema = z.preprocess(
  (value) => value ?? {},
  z.strictObject({
    ...authRoleShape,
    requirements: z
      .string({ error: "Milestone requirements must be text." })
      .trim()
      .max(CONTRACT_LIMITS.milestoneRequirementsMax, {
        error: "Milestone requirements are too long.",
      })
      .optional(),
  }),
);

export const submitMilestoneBodySchema = z.strictObject({
  ...authRoleShape,
  submissionMessage: boundedText("Submission message", {
    min: CONTRACT_LIMITS.submissionMessageMin,
    max: CONTRACT_LIMITS.submissionMessageMax,
  }),
  submissionDeliveryLink: z
    .string({ error: "Submission delivery link is invalid." })
    .trim()
    .max(CONTRACT_LIMITS.submissionDeliveryLinkMax, {
      error: "Submission delivery link is invalid.",
    })
    .optional(),
});

export const reviewMilestoneBodySchema = z.strictObject({
  ...authRoleShape,
  action: z.enum(["APPROVE", "REQUEST_CHANGES"], {
    error: "Milestone review action is invalid.",
  }),
  feedback: z
    .string({ error: "Feedback must be text." })
    .trim()
    .max(CONTRACT_LIMITS.feedbackMax, {
      error: `Feedback must be at most ${CONTRACT_LIMITS.feedbackMax} characters.`,
    })
    .optional(),
});

export const addMilestoneBodySchema = z.strictObject({
  ...authRoleShape,
  title: z
    .string({ error: "Milestone title must be 3–120 characters." })
    .trim()
    .min(CONTRACT_LIMITS.milestoneTitleMin, {
      error: "Milestone title must be 3–120 characters.",
    })
    .max(CONTRACT_LIMITS.milestoneTitleMax, {
      error: "Milestone title must be 3–120 characters.",
    }),
  amountCents: z
    .number({ error: MILESTONE_AMOUNT_ERROR })
    .int({ error: MILESTONE_AMOUNT_ERROR })
    .min(MIN_MILESTONE_CENTS, { error: MILESTONE_AMOUNT_ERROR })
    .max(MAX_MONEY_CENTS, { error: MILESTONE_AMOUNT_ERROR }),
  dueDate: z
    .string({ error: "Milestone due date is invalid." })
    .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Milestone due date is invalid." })
    .refine((value) => !Number.isNaN(Date.parse(value)), {
      error: "Milestone due date is invalid.",
    }),
});

export const finishContractBodySchema = z.strictObject({
  ...authRoleShape,
  rating: z
    .number({ error: "Rating must be between 1 and 5." })
    .int({ error: "Rating must be between 1 and 5." })
    .min(CONTRACT_LIMITS.ratingMin, {
      error: "Rating must be between 1 and 5.",
    })
    .max(CONTRACT_LIMITS.ratingMax, {
      error: "Rating must be between 1 and 5.",
    }),
  comment: z
    .string({ error: "Review must be 10–1000 characters." })
    .trim()
    .min(CONTRACT_LIMITS.reviewCommentMin, {
      error: "Review must be 10–1000 characters.",
    })
    .max(CONTRACT_LIMITS.reviewCommentMax, {
      error: "Review must be 10–1000 characters.",
    }),
});
