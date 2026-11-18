import { z } from "zod";
import { PAGINATION } from "../constants/pagination.constants.js";
import { authRoleShape } from "./common.schema.js";

const digitsInt = (label: string, { min, max }: { min: number; max: number }) =>
  z
    .string()
    .regex(/^\d+$/, { error: `${label} must be a non-negative integer.` })
    .transform(Number)
    .pipe(
      z
        .number()
        .int()
        .min(min, { error: `${label} must be at least ${min}.` })
        .max(max, { error: `${label} must be at most ${max}.` }),
    );

export const limitParam = ({
  defaultLimit = PAGINATION.defaultLimit,
  max = PAGINATION.maxLimit,
}: { defaultLimit?: number; max?: number } = {}) =>
  digitsInt("Limit", { min: PAGINATION.minLimit, max }).default(defaultLimit);

export const offsetParam = digitsInt("Offset", {
  min: PAGINATION.minOffset,
  max: PAGINATION.maxOffset,
}).default(PAGINATION.defaultOffset);

export const paginationShape = {
  limit: limitParam(),
  offset: offsetParam,
};

export const paginationQuerySchema = z.strictObject(paginationShape);

export const roleListQuerySchema = z.strictObject({
  ...authRoleShape,
  ...paginationShape,
});
