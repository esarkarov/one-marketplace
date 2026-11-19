import { z } from "zod";
import { isConnectsPlan } from "../utils/connects.plans.js";
import { authRoleShape } from "../../../shared/validation/schemas/common.schema.js";

const PLAN_ERROR = "Select a valid Connects package.";

export const roleOnlyQuerySchema = z.strictObject({ ...authRoleShape });

export const buyConnectsBodySchema = z.strictObject({
  ...authRoleShape,
  connects: z
    .number({ error: PLAN_ERROR })
    .refine(isConnectsPlan, { error: PLAN_ERROR }),
});
