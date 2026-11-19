import type { z } from "zod";

export type ValidationPart = "params" | "query" | "body";

export type SchemaInput = z.ZodType | z.ZodRawShape;

export type ResponseSchemas = Partial<Record<number, z.ZodType>>;

export interface RequestSchemas {
  body?: SchemaInput;
  params?: SchemaInput;
  query?: SchemaInput;
}

export interface ValidationInput extends RequestSchemas {
  responses?: ResponseSchemas;
}

export interface ValidationSchemas {
  body?: z.ZodType;
  params?: z.ZodType;
  query?: z.ZodType;
  responses?: ResponseSchemas;
}

export type ValidatedInput = Partial<Record<ValidationPart, unknown>>;

export type InferSchemaInput<S extends SchemaInput> = S extends z.ZodType
  ? z.output<S>
  : S extends z.ZodRawShape
    ? z.output<z.ZodObject<S, z.core.$strict>>
    : never;

export type Validated<S extends RequestSchemas> = {
  [
    K in ValidationPart as undefined extends S[K] ? never : K
  ]: S[K] extends SchemaInput ? InferSchemaInput<S[K]> : never;
};
