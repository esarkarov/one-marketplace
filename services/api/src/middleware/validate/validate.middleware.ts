import type { RequestHandler } from "express";
import { ApiError } from "../../shared/errors/api-error.js";
import type { ApiErrorDetail } from "../../shared/errors/api-error.js";
import {
  DEFAULT_MESSAGE,
  MAX_REPORTED_ERRORS,
  PARTS,
  VALIDATION_ERROR_CODE,
  VALIDATION_SCHEMAS,
} from "../constants/validate.constants.js";
import type {
  ValidationInput,
  ValidationPart,
  ValidationSchemas,
} from "../types/validate.types.js";
import {
  collectDetails,
  issueMessage,
  toSchema,
} from "../utils/validate.utils.js";

export const getValidationSchemas = (
  handler: unknown,
): ValidationSchemas | undefined =>
  typeof handler === "function"
    ? ((handler as unknown as Record<symbol, ValidationSchemas | undefined>)[
        VALIDATION_SCHEMAS
      ] ?? undefined)
    : undefined;

export const validate = (input: ValidationInput): RequestHandler => {
  const schemas: ValidationSchemas = {};
  if (input.params) schemas.params = toSchema(input.params);
  if (input.query) schemas.query = toSchema(input.query);
  if (input.body) schemas.body = toSchema(input.body);
  if (input.responses) schemas.responses = input.responses;

  const handler: RequestHandler = (request, _response, next) => {
    try {
      const parsed: Partial<Record<ValidationPart, unknown>> = {};
      const details: ApiErrorDetail[] = [];

      for (const part of PARTS) {
        const schema = schemas[part];
        if (!schema) continue;

        const result = schema.safeParse(request[part], {
          error: issueMessage,
        });

        if (result.success) {
          parsed[part] = result.data;
        } else {
          details.push(...collectDetails(part, result.error.issues));
        }
      }

      if (details.length > 0) {
        throw new ApiError(
          400,
          details[0]?.message || DEFAULT_MESSAGE,
          VALIDATION_ERROR_CODE,
          details.slice(0, MAX_REPORTED_ERRORS),
        );
      }

      if (schemas.params) {
        request.params = parsed.params as typeof request.params;
      }
      if (schemas.query) {
        Object.defineProperty(request, "query", {
          value: parsed.query,
          configurable: true,
          enumerable: true,
        });
      }
      if (schemas.body) request.body = parsed.body;

      next();
    } catch (error) {
      next(error);
    }
  };

  Object.defineProperty(handler, VALIDATION_SCHEMAS, { value: schemas });

  return handler;
};
