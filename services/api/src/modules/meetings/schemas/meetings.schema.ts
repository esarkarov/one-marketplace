import { z } from "zod";
import type { RequestSchemas } from "@/middleware/types/validate.types.js";
import {
  authRoleShape,
  uuidParam,
} from "@/shared/validation/schemas/common.schema.js";

export const createMeetingParamsSchema = z.strictObject({
  conversationId: uuidParam("Conversation"),
});

export const createMeetingQuerySchema = z.strictObject({ ...authRoleShape });

export const createMeetingRequest = {
  params: createMeetingParamsSchema,
  query: createMeetingQuerySchema,
} satisfies RequestSchemas;

export const dailyWebhookEventSchema = z.looseObject({
  id: z.unknown().optional(),
  type: z.string(),
  payload: z.looseObject({ room: z.string().optional() }).nullish(),
});

export type DailyWebhookEvent = z.infer<typeof dailyWebhookEventSchema>;
