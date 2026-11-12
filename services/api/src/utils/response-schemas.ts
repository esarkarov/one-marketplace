import { z } from "zod";

import { MAX_MONEY_CENTS } from "./money.js";

const MAX_VALIDATION_ERRORS = 50;

export const isoDateTime = z.iso
  .datetime({ error: "Expected an ISO 8601 date-time." })
  .meta({ id: "IsoDateTime" });

export const cents = z
  .number()
  .int()
  .min(0)
  .max(MAX_MONEY_CENTS)
  .meta({ id: "Cents" });

export const ok = <T extends z.ZodType>(data: T) =>
  z.strictObject({
    success: z.literal(true),
    message: z.string(),
    data,
  });

export const okNoData = z.strictObject({
  success: z.literal(true),
  message: z.string(),
});

export const ErrorBody = z
  .strictObject({
    success: z.literal(false),
    message: z.string(),
    code: z.string().optional(),
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
    requestId: z.string().min(1).max(64),
  })
  .meta({ id: "InternalErrorBody" });

export const RateLimitBody = z
  .strictObject({
    success: z.literal(false),
    message: z.literal("Too many requests. Please try again later."),
    requestId: z.string().min(1).max(64),
  })
  .meta({ id: "RateLimitBody" });

export const offsetPage = <T extends z.ZodType>(item: T) =>
  z.strictObject({
    results: z.array(item),
    hasMore: z.boolean(),
  });

export const cursorPage = <K extends string, T extends z.ZodType>(
  key: K,
  item: T,
) =>
  z.strictObject({
    [key]: z.array(item),
    nextCursor: z.string().nullable(),
  } as { [P in K]: z.ZodArray<T> } & {
    nextCursor: z.ZodNullable<z.ZodString>;
  });
