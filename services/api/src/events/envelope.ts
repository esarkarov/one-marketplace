import { randomUUID } from "node:crypto";
import { z } from "zod";
import { isMoneyCents } from "../utils/money.js";
import { upgradeV1Metadata } from "./legacy-v1.js";

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

const payloadFields = {
  type: z.string().min(1),
  title: z.string(),
  message: z.string(),
  link: z.string().optional(),
};

const metadataV1 = z.record(z.string(), z.unknown());

const metadataV2 = metadataV1.superRefine((metadata, ctx) => {
  if ("amount" in metadata) {
    ctx.addIssue({ code: "custom", message: "amount is not allowed" });
  }
  if ("amountCents" in metadata && !isMoneyCents(metadata.amountCents)) {
    ctx.addIssue({ code: "custom", message: "amountCents must be cents" });
  }
});

const notificationPayload = z
  .object({ ...payloadFields, metadata: metadataV2.optional() })
  .and(target);

const notificationPayloadV1 = z
  .object({ ...payloadFields, metadata: metadataV1.optional() })
  .and(target);

const envelopeFields = {
  id: z.uuid(),
  type: z.literal(NOTIFICATION_CREATED_TYPE),
  occurredAt: z.iso.datetime(),
};

const envelopeV2 = z.object({
  ...envelopeFields,
  version: z.literal(2),
  payload: notificationPayload,
});

const envelopeV1 = z
  .object({
    ...envelopeFields,
    version: z.literal(1),
    payload: notificationPayloadV1,
  })
  .transform((envelope, ctx) => {
    try {
      const metadata = upgradeV1Metadata(envelope.payload.metadata);
      const payload = { ...envelope.payload };
      if (metadata) payload.metadata = metadata;
      return { ...envelope, version: 2 as const, payload };
    } catch {
      ctx.addIssue({ code: "custom", message: "invalid v1 amount" });
      return z.NEVER;
    }
  })
  .pipe(envelopeV2);

export const notificationEnvelopeSchema = z.union([envelopeV2, envelopeV1]);

export type NotificationPayload = z.infer<typeof notificationPayload>;
export type NotificationEnvelope = z.infer<typeof envelopeV2>;
export type NotificationInput = NotificationPayload & { eventId?: string };

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
