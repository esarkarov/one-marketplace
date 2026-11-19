import { z } from "zod";
import type { RequestSchemas } from "../../../middleware/types/validate.types.js";
import { authRoleShape } from "../../../shared/validation/schemas/common.schema.js";

export const identitySessionQuerySchema = z.strictObject({
  ...authRoleShape,
  context: z.enum(["agency"], { error: "Context is invalid." }).optional(),
});

export const identitySessionRequest = {
  query: identitySessionQuerySchema,
} satisfies RequestSchemas;
