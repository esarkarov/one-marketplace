import { z } from "zod";

import { pagingDigits } from "../../shared/validation/common-schemas.js";
import { ADMIN_LIMITS } from "../../shared/validation/validation-limits.js";

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

export const adminListQuerySchema = z.strictObject({
  limit: pagingDigits("Limit").optional(),
  offset: pagingDigits("Offset").optional(),
});
