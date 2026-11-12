import { z } from "zod";
import {
  authRoleShape,
  boundedDataUrl,
  optionalBoundedText,
  pagingDigits,
  scopeField,
  uuidParam,
} from "../../shared/validation/common-schemas.js";
import {
  MAX_ATTACHMENT_FILE_NAME_LENGTH,
  MAX_ATTACHMENTS,
  MESSAGING_LIMITS,
} from "../../shared/validation/validation-limits.js";

const ATTACHMENT_ERROR = "Attachment metadata is invalid.";

const optionalUuid = (label: string) =>
  z
    .union([uuidParam(label), z.literal("")], { error: `${label} is invalid.` })
    .nullish();

export const conversationParamsSchema = z.strictObject({
  conversationId: uuidParam("Conversation"),
});

export const roleOnlyQuerySchema = z.strictObject({ ...authRoleShape });

export const listConversationsQuerySchema = z.strictObject({
  ...authRoleShape,
  scope: scopeField(["agency", "default"] as const).optional(),
});

export const openConversationBodySchema = z.strictObject({
  ...authRoleShape,
  recipientId: optionalBoundedText(
    "Recipient",
    MESSAGING_LIMITS.recipientId,
  ).optional(),
  jobId: optionalUuid("Job post"),
  proposalId: optionalUuid("Proposal"),
});

const attachmentSchema = z.strictObject(
  {
    fileUrl: boundedDataUrl("Attachment file"),
    fileName: z
      .string({ error: ATTACHMENT_ERROR })
      .trim()
      .min(1, { error: ATTACHMENT_ERROR })
      .max(MAX_ATTACHMENT_FILE_NAME_LENGTH, { error: ATTACHMENT_ERROR }),
    fileSize: z
      .number({ error: ATTACHMENT_ERROR })
      .int({ error: ATTACHMENT_ERROR }),
    mimeType: z
      .string({ error: ATTACHMENT_ERROR })
      .max(MESSAGING_LIMITS.attachmentMimeType, { error: ATTACHMENT_ERROR }),
  },
  { error: ATTACHMENT_ERROR },
);

export const createMessageBodySchema = z.strictObject({
  ...authRoleShape,
  body: z
    .string({ error: "Message must be text." })
    .trim()
    .max(MESSAGING_LIMITS.body, {
      error: "Message cannot exceed 10,000 characters.",
    })
    .nullish(),
  attachments: z
    .array(attachmentSchema, { error: "Attachments must be an array." })
    .max(MAX_ATTACHMENTS, {
      error: "A message can contain up to 5 attachments.",
    })
    .nullish(),
  replyToMessageId: optionalUuid("Reply message"),
});

export const listMessagesQuerySchema = z.strictObject({
  ...authRoleShape,
  cursor: z
    .string({ error: "Cursor is invalid." })
    .max(MESSAGING_LIMITS.cursor, { error: "Cursor is invalid." })
    .optional(),
  limit: pagingDigits("Limit").optional(),
});

export const readConversationBodySchema = z.strictObject({
  ...authRoleShape,
  lastReadMessageId: uuidParam("Last read message"),
});
