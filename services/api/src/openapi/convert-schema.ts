import { z } from "zod";
import {
  isObject,
  sortKeys,
  type Json,
  type JsonObject,
} from "./schema-walk.js";

export const IGNORED_PROPERTY_DESCRIPTION =
  "Accepted for compatibility and ignored by the server.";

const DEFS_PREFIX = "#/$defs/";
const COMPONENTS_PREFIX = "#/components/schemas/";

export type ComponentSchemas = Record<string, JsonObject>;
type Io = "input" | "output";

const isEmpty = (value: Json) =>
  isObject(value) && Object.keys(value).length === 0;

const rewrite = (node: Json, io: Io): Json => {
  if (Array.isArray(node)) return node.map((item) => rewrite(item, io));
  if (!isObject(node)) return node;

  const result: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "$ref" && typeof value === "string") {
      result[key] = value.startsWith(DEFS_PREFIX)
        ? `${COMPONENTS_PREFIX}${value.slice(DEFS_PREFIX.length)}`
        : value;
    } else if (key === "properties" && isObject(value)) {
      const properties: JsonObject = {};
      for (const [name, property] of Object.entries(value)) {
        properties[name] =
          io === "input" && isEmpty(property)
            ? { description: IGNORED_PROPERTY_DESCRIPTION }
            : rewrite(property, io);
      }
      result[key] = properties;
    } else if (key === "additionalProperties" && isEmpty(value)) {
      result[key] = true;
    } else {
      result[key] = rewrite(value, io);
    }
  }
  return result;
};

const stable = (value: Json) => JSON.stringify(sortKeys(value));

export const registerComponent = (
  components: ComponentSchemas,
  id: string,
  schema: JsonObject,
) => {
  const existing = components[id];
  if (existing && stable(existing) !== stable(schema)) {
    throw new Error(
      `Schema id "${id}" is used for two different definitions; give them distinct ids.`,
    );
  }
  components[id] = schema;
};

interface Def {
  type: string;
  in?: { _zod: { def: Def } };
  out?: { _zod: { def: Def } } & z.ZodType;
}

const defOf = (schema: z.ZodType) =>
  (schema as unknown as { _zod: { def: Def } })._zod.def;

const isDigitPipe = (def: Def) =>
  def.type === "pipe" &&
  def.in?._zod.def.type === "pipe" &&
  def.in._zod.def.out?._zod.def.type === "transform";

const widenDigitPipe = (zodSchema: z.ZodType, jsonSchema: JsonObject) => {
  const def = defOf(zodSchema);
  if (!isDigitPipe(def) || !def.out) return;
  const out = z.toJSONSchema(def.out, {
    target: "draft-2020-12",
    io: "output",
    unrepresentable: "throw",
  }) as unknown as JsonObject;
  if (out.$defs !== undefined || out.$ref !== undefined) {
    throw new Error("A digit-string pipe must not end in a schema with an id.");
  }
  delete out.$schema;
  for (const key of Object.keys(jsonSchema)) delete jsonSchema[key];
  Object.assign(jsonSchema, out);
};

export const convertSchema = (
  schema: z.ZodType,
  io: Io,
  components: ComponentSchemas,
): JsonObject => {
  const raw = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io,
    unrepresentable: "throw",
    ...(io === "input" && {
      override: (ctx) =>
        widenDigitPipe(
          ctx.zodSchema as unknown as z.ZodType,
          ctx.jsonSchema as JsonObject,
        ),
    }),
  }) as unknown as JsonObject;

  const defs = raw.$defs;
  delete raw.$schema;
  delete raw.$defs;

  if (isObject(defs)) {
    for (const [id, definition] of Object.entries(defs)) {
      registerComponent(components, id, rewrite(definition, io) as JsonObject);
    }
  }

  return rewrite(raw, io) as JsonObject;
};
