import { z } from "zod";
import { isObject, sortKeys } from "../utils/json.utils.js";
import {
  COMPONENTS_PREFIX,
  DEFS_PREFIX,
  IGNORED_PROPERTY_DESCRIPTION,
} from "../constants/openapi.constants.js";
import type {
  ComponentSchemas,
  Json,
  JsonObject,
} from "../types/openapi.types.js";

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
  defaultValue?: unknown;
  innerType?: { _zod: { def: Def } };
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

const documentDefault = (zodSchema: z.ZodType, jsonSchema: JsonObject) => {
  const def = defOf(zodSchema);
  if (def.type !== "default" || !isDigitPipe(def.innerType?._zod.def ?? def)) {
    return;
  }
  if (typeof def.defaultValue === "number") {
    jsonSchema.default = def.defaultValue;
  }
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
      override: (ctx) => {
        const zodSchema = ctx.zodSchema as unknown as z.ZodType;
        const jsonSchema = ctx.jsonSchema as JsonObject;
        widenDigitPipe(zodSchema, jsonSchema);
        documentDefault(zodSchema, jsonSchema);
      },
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
