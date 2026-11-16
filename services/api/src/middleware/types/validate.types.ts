import type { z } from "zod";

export type ValidationPart = "params" | "query" | "body";

export type SchemaInput = z.ZodType | z.ZodRawShape;

export type ResponseSchemas = Partial<Record<number, z.ZodType>>;

export interface ValidationInput {
  body?: SchemaInput;
  params?: SchemaInput;
  query?: SchemaInput;
  responses?: ResponseSchemas;
}

export interface ValidationSchemas {
  body?: z.ZodType;
  params?: z.ZodType;
  query?: z.ZodType;
  responses?: ResponseSchemas;
}
