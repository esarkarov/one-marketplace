import { z } from "zod";

import { paginationQuerySchema } from "../../../shared/validation/schemas/pagination.schema.js";
import { ADMIN_LIMITS } from "../constants/admin.constants.js";

export const adminLoginBodySchema = z.strictObject({
  password: z
    .string({ error: "Password must be text." })
    .max(ADMIN_LIMITS.password, { error: "Password is too long." }),
});

export const adminLogStreamQuerySchema = z.strictObject({
  token: z
    .string()
    .max(ADMIN_LIMITS.streamToken, { error: "Token is too long." })
    .optional(),
});

export const adminListQuerySchema = paginationQuerySchema;
