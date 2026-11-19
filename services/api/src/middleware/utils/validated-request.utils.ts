import type { Request } from "express";
import { ApiError } from "@/shared/errors/api-error.js";
import { PARTS } from "@/middleware/constants/validate.constants.js";
import type {
  RequestSchemas,
  Validated,
} from "@/middleware/types/validate.types.js";

export const getValidated = <const S extends RequestSchemas>(
  request: Request,
  schemas: S,
): Validated<S> => {
  const recorded = request.validated;
  const result: Record<string, unknown> = {};

  for (const part of PARTS) {
    if (!schemas[part]) continue;

    if (!recorded || !(part in recorded)) {
      throw new ApiError(
        500,
        `validate() did not run for request ${part} on ${request.method} ${request.path}.`,
      );
    }

    result[part] = recorded[part];
  }

  // The only cast: `request.validated` is untyped storage, and its parts were
  // produced by parsing the same schemas the caller passes here.
  return result as Validated<S>;
};
