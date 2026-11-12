import { z } from "zod";
import { authRoleShape } from "../../shared/validation/common-schemas.js";

export const identitySessionQuerySchema = z.strictObject({
  ...authRoleShape,
  context: z.enum(["agency"], { error: "Context is invalid." }).optional(),
});
