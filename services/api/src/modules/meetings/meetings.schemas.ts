import { z } from "zod";
import {
  authRoleShape,
  uuidParam,
} from "../../shared/validation/common-schemas.js";

export const createMeetingParamsSchema = z.strictObject({
  conversationId: uuidParam("Conversation"),
});

export const createMeetingQuerySchema = z.strictObject({ ...authRoleShape });
