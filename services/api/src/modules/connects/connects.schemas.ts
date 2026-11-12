import { z } from "zod";
import { CONNECTS_PLANS } from "../../config/constants.js";
import { authRoleShape } from "../../shared/validation/common-schemas.js";

const PLAN_ERROR = "Select a valid Connects package.";

export const roleOnlyQuerySchema = z.strictObject({ ...authRoleShape });

export const buyConnectsBodySchema = z.strictObject({
  ...authRoleShape,
  connects: z
    .number({ error: PLAN_ERROR })
    .refine((value) => Object.hasOwn(CONNECTS_PLANS, String(value)), {
      error: PLAN_ERROR,
    }),
});
