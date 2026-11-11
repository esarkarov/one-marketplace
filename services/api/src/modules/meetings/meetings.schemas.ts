import { z } from "zod";
import { authRoleShape, uuidParam } from "../../utils/common-schemas.js";

export const createMeetingParamsSchema = z.strictObject({
  conversationId: uuidParam("Conversation"),
});

export const createMeetingQuerySchema = z.strictObject({ ...authRoleShape });
