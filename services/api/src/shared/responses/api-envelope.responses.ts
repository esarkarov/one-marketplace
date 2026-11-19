import { z } from "zod";
import { DEFAULT_ERROR_CODES } from "@/shared/errors/api-error.js";

const MAX_VALIDATION_ERRORS = 50;

export const errorCodeEnum = <const T extends readonly string[]>(
  ...explicit: T
) => z.enum([...DEFAULT_ERROR_CODES, ...explicit]);

export const requestIdField = z.string().min(1).max(64);

export const ok = <T extends z.ZodType>(data: T) =>
  z.strictObject({
    success: z.literal(true),
    message: z.string(),
    data,
  });

export const okNoData = z.strictObject({
  success: z.literal(true),
  message: z.string(),
  data: z.null(),
});

export const ErrorBody = z
  .strictObject({
    success: z.literal(false),
    message: z.string(),
    code: z.string().min(1),
    requestId: requestIdField,
    errors: z
      .array(z.strictObject({ path: z.string(), message: z.string() }))
      .optional(),
  })
  .meta({ id: "ErrorBody" });

export const ValidationErrorBody = z
  .strictObject({
    success: z.literal(false),
    message: z.string(),
    code: z.literal("VALIDATION_ERROR"),
    requestId: requestIdField,
    errors: z
      .array(z.strictObject({ path: z.string(), message: z.string() }))
      .max(MAX_VALIDATION_ERRORS),
  })
  .meta({ id: "ValidationErrorBody" });

export const BadRequestBody = z.union([ValidationErrorBody, ErrorBody]);

export const InternalErrorBody = z
  .strictObject({
    success: z.literal(false),
    message: z.literal("Internal server error."),
    code: z.literal("INTERNAL_ERROR"),
    requestId: requestIdField,
  })
  .meta({ id: "InternalErrorBody" });

export const RateLimitBody = z
  .strictObject({
    success: z.literal(false),
    message: z.literal("Too many requests. Please try again later."),
    code: z.literal("RATE_LIMITED"),
    requestId: requestIdField,
  })
  .meta({ id: "RateLimitBody" });

export const offsetPage = <T extends z.ZodType>(item: T) =>
  z.strictObject({
    results: z.array(item),
    hasMore: z.boolean(),
  });

export const cursorPage = <T extends z.ZodType>(item: T) =>
  z.strictObject({
    results: z.array(item),
    nextCursor: z.string().nullable(),
  });
