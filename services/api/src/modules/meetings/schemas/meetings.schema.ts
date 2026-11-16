import { z } from "zod";
import {
  authRoleShape,
  uuidParam,
} from "../../../shared/validation/schemas/common.schema.js";

export const createMeetingParamsSchema = z.strictObject({
  conversationId: uuidParam("Conversation"),
});

export const createMeetingQuerySchema = z.strictObject({ ...authRoleShape });
