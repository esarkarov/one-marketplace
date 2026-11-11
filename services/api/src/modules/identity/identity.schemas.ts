import { z } from "zod";
import { authRoleShape } from "../../utils/common-schemas.js";

export const identitySessionQuerySchema = z.strictObject({
  ...authRoleShape,
  context: z.enum(["agency"], { error: "Context is invalid." }).optional(),
});
