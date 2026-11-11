import { z } from "zod";
import {
  COMMON_LIMITS,
  MAX_DATA_URL_HEADER_LENGTH,
  MAX_ENCODED_LENGTH,
} from "./validation-limits.js";

export const ACCOUNT_ROLES = ["client", "freelancer"] as const;

export const roleField = z.enum(ACCOUNT_ROLES, {
  error: "A valid account role is required.",
});

export const authRoleShape = { role: roleField.optional() };

export const uuidParam = (label = "Id") =>
  z.uuid({ error: `${label} is invalid.` });

export const uuidParams = <const K extends string>(...names: readonly K[]) =>
  z.strictObject(
    Object.fromEntries(names.map((name) => [name, uuidParam(name)])) as Record<
      K,
      ReturnType<typeof uuidParam>
    >,
  );

export const boundedText = (
  label: string,
  { min = 1, max }: { min?: number; max: number },
) =>
  z
    .string({ error: `${label} must be text.` })
    .trim()
    .min(min, { error: `${label} must be at least ${min} characters.` })
    .max(max, { error: `${label} must be at most ${max} characters.` });

export const optionalBoundedText = (label: string, max: number) =>
  boundedText(label, { min: 0, max });

const MAX_DATA_URL_LENGTH = MAX_ENCODED_LENGTH + MAX_DATA_URL_HEADER_LENGTH;

export const boundedDataUrl = (label = "Attachment file") =>
  z
    .string({ error: `${label} must be text.` })
    .max(MAX_DATA_URL_LENGTH, { error: `${label} is too large.` });

export const pagingDigits = (label = "Value") =>
  z
    .string({ error: `${label} must be a non-negative integer.` })
    .max(COMMON_LIMITS.pagingDigits, {
      error: `${label} must be at most ${COMMON_LIMITS.pagingDigits} digits.`,
    })
    .regex(/^\d+$/, { error: `${label} must be a non-negative integer.` });

export const scopeField = <const T extends readonly [string, ...string[]]>(
  values: T,
) => z.enum(values, { error: "Scope is invalid." });

export const withIgnoredKeys = <
  S extends z.ZodRawShape,
  const K extends readonly string[],
>(
  shape: S,
  keys: K,
) => {
  const ignored = Object.fromEntries(
    keys.map((key) => [key, z.unknown().optional()]),
  );

  return z.strictObject({ ...ignored, ...shape }).transform((value) => {
    const copy: Record<string, unknown> = { ...value };
    for (const key of keys) {
      if (!(key in shape)) delete copy[key];
    }
    return copy as z.output<z.ZodObject<S>>;
  });
};
