import type { ValidationPart } from "@/middleware/types/validate.types.js";

export const VALIDATION_SCHEMAS = Symbol("onemarketplace.validation-schemas");

export const VALIDATION_ERROR_CODE = "VALIDATION_ERROR";

export const DEFAULT_MESSAGE = "Invalid request.";
export const MAX_REPORTED_ERRORS = 50;
export const MAX_KEY_NAME_LENGTH = 64;
export const PARTS: readonly ValidationPart[] = ["params", "query", "body"];
