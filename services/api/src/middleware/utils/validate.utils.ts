import { z } from "zod";
import type { ApiErrorDetail } from "../../shared/errors/api-error.js";
import {
  DEFAULT_MESSAGE,
  MAX_KEY_NAME_LENGTH,
} from "../constants/validate.constants.js";
import type { SchemaInput, ValidationPart } from "../types/validate.types.js";

export const toSchema = (input: SchemaInput): z.ZodType =>
  input instanceof z.ZodType ? input : z.strictObject(input);

export const issueMessage = (issue: {
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

export const collectDetails = (
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
