import { z } from "zod";

import {
  authRoleShape,
  boundedDataUrl,
  optionalBoundedText,
  pagingDigits,
  uuidParam,
  withIgnoredKeys,
} from "../../utils/common-schemas.js";
import { moneyCents } from "../../utils/money.js";
import {
  COMMON_LIMITS,
  JOB_LIMITS,
  MESSAGING_LIMITS,
  MAX_ATTACHMENT_FILE_NAME_LENGTH,
  MAX_ATTACHMENTS,
  SEARCH_QUERY_MAX_LENGTH,
} from "../../utils/validation-limits.js";

const BUDGET_ERROR = "Every milestone needs a valid budget.";

export const MAX_JOB_BUDGET_CENTS = 100_000_000;

const textList = (
  label: string,
  maxItems: number,
  maxLength: number,
  arrayMessage: string,
) =>
  z
    .array(optionalBoundedText(label, maxLength), { error: arrayMessage })
    .max(maxItems, { error: `${label} list has too many items.` })
    .nullish();

const milestoneSchema = z.strictObject(
  {
    id: z
      .union([
        z.string().max(JOB_LIMITS.milestoneIdMax, {
          error: "Milestone id is too long.",
        }),
        z.number({ error: "Milestone id is invalid." }),
      ])
      .nullish(),
    title: optionalBoundedText(
      "Milestone title",
      JOB_LIMITS.milestoneTitleMax,
    ).optional(),
    budgetCents: z
      .number({ error: BUDGET_ERROR })
      .int({ error: BUDGET_ERROR })
      .min(501, { error: BUDGET_ERROR })
      .max(MAX_JOB_BUDGET_CENTS, { error: BUDGET_ERROR }),
    dueDate: optionalBoundedText(
      "Milestone due date",
      JOB_LIMITS.milestoneDueDateMax,
    ).optional(),
  },
  { error: "Each milestone must be an object." },
);

const attachmentSchema = z.strictObject(
  {
    fileId: z
      .string()
      .max(COMMON_LIMITS.attachmentFileId, {
        error: "Attachment id is too long.",
      })
      .nullish(),
    fileName: z
      .string({ error: "Attachment name must be text." })
      .max(MAX_ATTACHMENT_FILE_NAME_LENGTH, {
        error: "Attachment name is too long.",
      })
      .optional(),
    fileUrl: boundedDataUrl().optional(),
    fileType: z
      .string({ error: "Attachment type must be text." })
      .max(MESSAGING_LIMITS.attachmentMimeType, {
        error: "Attachment type is too long.",
      })
      .optional(),
    fileSize: z
      .number({ error: "Attachment size must be a number." })
      .min(0, { error: "Attachment size must be a number." })
      .nullish(),
  },
  { error: "Each attachment must be an object." },
);

export const jobIdParamsSchema = z.strictObject({
  jobId: uuidParam("Job post id"),
});

export const jobBodySchema = withIgnoredKeys(
  {
    ...authRoleShape,
    title: optionalBoundedText("Job title", JOB_LIMITS.titleMax).optional(),
    description: optionalBoundedText(
      "Job description",
      JOB_LIMITS.descriptionMax,
    ).optional(),
    expertise_level: optionalBoundedText(
      "Expertise level",
      JOB_LIMITS.expertiseLevelMax,
    ).optional(),
    expected_duration: optionalBoundedText(
      "Expected duration",
      JOB_LIMITS.expectedDurationMax,
    ).optional(),
    status: z
      .string({ error: "Status must be text." })
      .max(JOB_LIMITS.statusMax, { error: "Status is too long." })
      .nullish(),
    skills: textList(
      "Skills",
      JOB_LIMITS.skillsMaxItems,
      JOB_LIMITS.skillMaxLength,
      "Skills must be an array.",
    ),
    screening_questions: textList(
      "Screening questions",
      JOB_LIMITS.screeningQuestionsMaxItems,
      JOB_LIMITS.screeningQuestionMaxLength,
      "Screening questions must be an array.",
    ),
    milestones: z
      .array(milestoneSchema, { error: "Milestones must be an array." })
      .max(JOB_LIMITS.milestonesMaxItems, {
        error: "Too many milestones.",
      })
      .optional(),
    attachments: z
      .array(attachmentSchema, { error: "Attachments must be an array." })
      .max(MAX_ATTACHMENTS, {
        error: `A job post can have up to ${MAX_ATTACHMENTS} attachments.`,
      })
      .nullish(),
  },
  ["id", "imageId", "createdAt", "updatedAt"],
);

export type JobBody = z.output<typeof jobBodySchema>;

const budgetFilter = z
  .string()
  .regex(/^\d+$/, {
    error: "Budget filter must be an integer number of cents.",
  })
  .transform(Number)
  .pipe(moneyCents)
  .optional();

export const publicJobFeedQuerySchema = z.strictObject({
  query: z
    .string()
    .max(SEARCH_QUERY_MAX_LENGTH, {
      error: `Search text must be at most ${SEARCH_QUERY_MAX_LENGTH} characters.`,
    })
    .optional(),
  sort: z
    .string()
    .max(JOB_LIMITS.feedSortMax, { error: "Sort is invalid." })
    .optional(),
  offset: pagingDigits("Offset").optional(),
  levels: z
    .string()
    .max(JOB_LIMITS.feedLevelsMax, { error: "Levels filter is too long." })
    .optional(),
  paymentVerified: z
    .enum(["true", "false"], {
      error: "Payment verified filter must be true or false.",
    })
    .optional(),
  minBudgetCents: budgetFilter,
  maxBudgetCents: budgetFilter,
  maxProposals: pagingDigits("Max proposals").optional(),
});
