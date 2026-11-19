import { z } from "zod";
import type { RequestSchemas } from "../../../middleware/types/validate.types.js";
import { isConnectsPlan } from "../utils/connects.plans.js";
import { authRoleShape } from "../../../shared/validation/schemas/common.schema.js";
import { roleListQuerySchema } from "../../../shared/validation/schemas/pagination.schema.js";

const PLAN_ERROR = "Select a valid Connects package.";

export const roleOnlyQuerySchema = z.strictObject({ ...authRoleShape });

export const buyConnectsBodySchema = z.strictObject({
  ...authRoleShape,
  connects: z
    .number({ error: PLAN_ERROR })
    .refine(isConnectsPlan, { error: PLAN_ERROR }),
});

export const connectsHistoryRequest = {
  query: roleListQuerySchema,
} satisfies RequestSchemas;

export const buyConnectsRequest = {
  query: roleOnlyQuerySchema,
  body: buyConnectsBodySchema,
} satisfies RequestSchemas;
