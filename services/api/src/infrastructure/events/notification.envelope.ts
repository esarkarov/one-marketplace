import { randomUUID } from "node:crypto";
import { z } from "zod";
import { isMoneyCents } from "../../shared/money/money.js";
import { NOTIFICATION_CREATED_TYPE } from "../constants/index.js";
import type {
  NotificationEnvelope,
  NotificationInput,
} from "../types/index.js";

const notificationMetadataSchema = z
  .record(z.string(), z.unknown())
  .superRefine((metadata, ctx) => {
    if ("amount" in metadata) {
      ctx.addIssue({ code: "custom", message: "amount is not allowed" });
    }
    if ("amountCents" in metadata && !isMoneyCents(metadata.amountCents)) {
      ctx.addIssue({ code: "custom", message: "amountCents must be cents" });
    }
  });

const notificationTargetSchema = z.union([
  z.object({
    recipientId: z.string().min(1),
    agencyId: z.undefined().optional(),
  }),
  z.object({
    agencyId: z.guid(),
    recipientId: z.undefined().optional(),
  }),
]);

const notificationPayloadSchema = z
  .object({
    type: z.string().min(1),
    title: z.string(),
    message: z.string(),
    link: z.string().optional(),
    metadata: notificationMetadataSchema.optional(),
  })
  .and(notificationTargetSchema);

export const notificationEnvelopeSchema = z.object({
  id: z.uuid(),
  type: z.literal(NOTIFICATION_CREATED_TYPE),
  occurredAt: z.iso.datetime(),
  version: z.literal(2),
  payload: notificationPayloadSchema,
}) satisfies z.ZodType<NotificationEnvelope>;

export const createNotificationEnvelope = (
  input: NotificationInput,
): NotificationEnvelope => {
  const { eventId, ...payload } = input;
  return {
    id: eventId ?? randomUUID(),
    type: NOTIFICATION_CREATED_TYPE,
    version: 2,
    occurredAt: new Date().toISOString(),
    payload,
  };
};
