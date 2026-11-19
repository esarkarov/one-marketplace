import { z } from "zod";
import type { RequestSchemas } from "@/middleware/types/validate.types.js";
import { paginationQuerySchema } from "@/shared/validation/schemas/pagination.schema.js";
import {
  redisKeyParamsSchema,
  redisScanQuerySchema,
} from "./admin.redis.schema.js";
import { ADMIN_LIMITS } from "@/modules/admin/constants/admin.constants.js";

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

export const adminLoginRequest = {
  body: adminLoginBodySchema,
  query: {},
} satisfies RequestSchemas;

export const adminListRequest = {
  query: adminListQuerySchema,
} satisfies RequestSchemas;

export const adminRedisScanRequest = {
  query: redisScanQuerySchema,
} satisfies RequestSchemas;

export const adminRedisKeyRequest = {
  params: redisKeyParamsSchema,
  query: {},
} satisfies RequestSchemas;
