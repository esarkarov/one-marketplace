import { RequestHandler } from "express";
import { z } from "zod";
import { ApiError, ApiErrorDetail } from "../utils/api-error.js";

export type ValidationPart = "params" | "query" | "body";

export type SchemaInput = z.ZodType | z.ZodRawShape;

export interface ValidationInput {
  body?: SchemaInput;
  params?: SchemaInput;
  query?: SchemaInput;
}

export interface ValidationSchemas {
  body?: z.ZodType;
  params?: z.ZodType;
  query?: z.ZodType;
}

export const VALIDATION_SCHEMAS = Symbol("onemarketplace.validation-schemas");

export const VALIDATION_ERROR_CODE = "VALIDATION_ERROR";

const DEFAULT_MESSAGE = "Invalid request.";
const MAX_REPORTED_ERRORS = 50;
const MAX_KEY_NAME_LENGTH = 64;
const PARTS: readonly ValidationPart[] = ["params", "query", "body"];

const toSchema = (input: SchemaInput): z.ZodType =>
  input instanceof z.ZodType ? input : z.strictObject(input);

const issueMessage = (issue: {
  code: string;
  input?: unknown;
}): string | undefined => {
  switch (issue.code) {
    case "unrecognized_keys":
      return "Unknown field.";
    case "invalid_type":
      return issue.input === undefined ? "Required." : "Invalid type.";
    case "too_small":
    case "too_big":
      return "Value is out of the allowed range.";
    case "invalid_format":
      return "Invalid format.";
    case "invalid_value":
      return undefined;
    case "invalid_union":
      return "Invalid value.";
    default:
      return DEFAULT_MESSAGE;
  }
};

const joinPath = (part: ValidationPart, path: readonly PropertyKey[]) =>
  [part, ...path.map(String)].join(".");

const collectDetails = (
  part: ValidationPart,
  issues: readonly z.core.$ZodIssue[],
): ApiErrorDetail[] =>
  issues.flatMap((issue): ApiErrorDetail[] => {
    const message = issue.message || DEFAULT_MESSAGE;

    if (issue.code === "unrecognized_keys") {
      return issue.keys.map((key) => ({
        path: joinPath(part, [
          ...issue.path,
          key.slice(0, MAX_KEY_NAME_LENGTH),
        ]),
        message,
      }));
    }

    return [{ path: joinPath(part, issue.path), message }];
  });

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
