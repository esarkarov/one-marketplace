import { randomUUID } from "node:crypto";
import { z } from "zod";

export const NOTIFICATION_CREATED_TYPE = "notifications.created";

const target = z.union([
  z.object({
    recipientId: z.string().min(1),
    agencyId: z.undefined().optional(),
  }),
  z.object({
    agencyId: z.guid(),
    recipientId: z.undefined().optional(),
  }),
]);

const notificationPayload = z
  .object({
    type: z.string().min(1),
    title: z.string(),
    message: z.string(),
    link: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .and(target);

export const notificationEnvelopeSchema = z.object({
  id: z.uuid(),
  type: z.literal(NOTIFICATION_CREATED_TYPE),
  version: z.literal(1),
  occurredAt: z.iso.datetime(),
  payload: notificationPayload,
});

export type NotificationPayload = z.infer<typeof notificationPayload>;
export type NotificationEnvelope = z.infer<typeof notificationEnvelopeSchema>;

export const createNotificationEnvelope = (
  payload: NotificationPayload,
): NotificationEnvelope => ({
  id: randomUUID(),
  type: NOTIFICATION_CREATED_TYPE,
  version: 1,
  occurredAt: new Date().toISOString(),
  payload,
});
