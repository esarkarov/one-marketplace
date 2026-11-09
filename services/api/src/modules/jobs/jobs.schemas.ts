import { z } from "zod";

const optionalText = z.string().optional().catch(undefined);
const optionalScalar = z
  .union([z.string(), z.number()])
  .optional()
  .catch(undefined);

const textList = (message: string) =>
  z.array(z.union([z.string(), z.number()]), { error: message }).nullish();

const milestoneSchema = z.object(
  {
    id: optionalScalar,
    title: optionalText,
    budget: optionalScalar,
    dueDate: optionalText,
  },
  { error: "Each milestone must be an object." },
);

const attachmentSchema = z.object(
  {
    fileId: optionalText,
    fileName: optionalText,
    fileUrl: optionalText,
    fileType: optionalText,
    fileSize: optionalScalar,
  },
  { error: "Each attachment must be an object." },
);

export const emptyQuerySchema = z.object({});

export const jobIdParamsSchema = z.object({
  jobId: z.guid({ error: "Job post id is invalid." }),
});

export const jobBodySchema = z.object(
  {
    title: optionalText,
    description: optionalText,
    expertise_level: optionalText,
    expected_duration: optionalText,
    status: optionalText,
    skills: textList("Skills must be an array."),
    screening_questions: textList("Screening questions must be an array."),
    milestones: z
      .array(milestoneSchema, { error: "Milestones must be an array." })
      .nullish(),
    attachments: z
      .array(attachmentSchema, { error: "Attachments must be an array." })
      .nullish(),
  },
  { error: "Request body must be an object." },
);

export const publicJobFeedQuerySchema = z.object({
  query: optionalText,
  sort: optionalText,
  offset: optionalText,
  levels: optionalText,
  paymentVerified: optionalText,
  minBudget: optionalText,
  maxBudget: optionalText,
  maxProposals: optionalText,
});
