import { RequestHandler } from "express";
import { z } from "zod";
import { ApiError } from "../utils/api-error.js";

interface ValidationSchemas {
  body?: z.ZodType;
  params?: z.ZodType;
  query?: z.ZodType;
}

const DEFAULT_MESSAGE = "Invalid request.";

const parseOrThrow = (schema: z.ZodType, value: unknown) => {
  const result = schema.safeParse(value, { error: () => DEFAULT_MESSAGE });

  if (!result.success) {
    throw new ApiError(400, result.error.issues[0]?.message ?? DEFAULT_MESSAGE);
  }

  return result.data;
};

export const validate =
  ({ body, params, query }: ValidationSchemas): RequestHandler =>
  (request, _response, next) => {
    try {
      const parsedParams = params && parseOrThrow(params, request.params);
      const parsedQuery = query && parseOrThrow(query, request.query);
      const parsedBody = body && parseOrThrow(body, request.body);

      if (params) request.params = parsedParams as typeof request.params;
      if (query) {
        Object.defineProperty(request, "query", {
          value: parsedQuery,
          configurable: true,
          enumerable: true,
        });
      }
      if (body) request.body = parsedBody;

      next();
    } catch (error) {
      next(error);
    }
  };
