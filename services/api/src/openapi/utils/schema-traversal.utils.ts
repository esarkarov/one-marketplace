import { isObject } from "./json.utils.js";
import type { Json, JsonObject } from "../types/openapi.types.js";

const SCHEMA_KEYS = [
  "items",
  "additionalProperties",
  "unevaluatedProperties",
  "propertyNames",
  "contains",
  "not",
  "if",
  "then",
  "else",
] as const;
const SCHEMA_LIST_KEYS = ["allOf", "anyOf", "oneOf", "prefixItems"] as const;
const SCHEMA_MAP_KEYS = ["properties", "patternProperties", "$defs"] as const;

type SchemaVisitor = (
  schema: JsonObject,
  path: string,
  propertyName: string | undefined,
) => void;

export const walkSchema = (
  schema: Json | undefined,
  path: string,
  visit: SchemaVisitor,
  propertyName?: string,
): void => {
  if (!isObject(schema)) return;
  visit(schema, path, propertyName);

  for (const key of SCHEMA_KEYS) {
    walkSchema(schema[key], `${path}/${key}`, visit);
  }
  for (const key of SCHEMA_LIST_KEYS) {
    const list = schema[key];
    if (Array.isArray(list)) {
      list.forEach((item, index) =>
        walkSchema(item, `${path}/${key}/${index}`, visit),
      );
    }
  }
  for (const key of SCHEMA_MAP_KEYS) {
    const map = schema[key];
    if (!isObject(map)) continue;
    for (const [name, child] of Object.entries(map)) {
      walkSchema(
        child,
        `${path}/${key}/${name}`,
        visit,
        key === "properties" ? name : undefined,
      );
    }
  }
};

type DocumentSchemaKind = "component" | "parameter" | "request" | "response";

export const walkDocumentSchemas = (
  document: JsonObject,
  visit: (
    schema: JsonObject,
    path: string,
    propertyName: string | undefined,
    kind: DocumentSchemaKind,
  ) => void,
): void => {
  const components = document.components;
  const schemas = isObject(components) ? components.schemas : undefined;
  if (isObject(schemas)) {
    for (const [id, schema] of Object.entries(schemas)) {
      walkSchema(schema, `#/components/schemas/${id}`, (node, path, name) =>
        visit(node, path, name, "component"),
      );
    }
  }

  const paths = document.paths;
  if (!isObject(paths)) return;

  for (const [path, item] of Object.entries(paths)) {
    if (!isObject(item)) continue;
    for (const [method, operation] of Object.entries(item)) {
      if (!isObject(operation)) continue;
      const base = `#/paths/${path}/${method}`;

      const parameters = operation.parameters;
      if (Array.isArray(parameters)) {
        parameters.forEach((parameter, index) => {
          if (!isObject(parameter)) return;
          const root = `${base}/parameters/${index}/schema`;
          walkSchema(parameter.schema, root, (node, nodePath, name) =>
            visit(
              node,
              nodePath,
              nodePath === root ? String(parameter.name) : name,
              "parameter",
            ),
          );
        });
      }

      const body = operation.requestBody;
      if (isObject(body) && isObject(body.content)) {
        for (const [type, media] of Object.entries(body.content)) {
          if (!isObject(media)) continue;
          walkSchema(
            media.schema,
            `${base}/requestBody/${type}/schema`,
            (node, nodePath, name) => visit(node, nodePath, name, "request"),
          );
        }
      }

      const responses = operation.responses;
      if (!isObject(responses)) continue;
      for (const [status, response] of Object.entries(responses)) {
        if (!isObject(response) || !isObject(response.content)) continue;
        for (const [type, media] of Object.entries(response.content)) {
          if (!isObject(media)) continue;
          walkSchema(
            media.schema,
            `${base}/responses/${status}/${type}/schema`,
            (node, nodePath, name) => visit(node, nodePath, name, "response"),
          );
        }
      }
    }
  }
};

export const findEmptySchemas = (document: JsonObject): string[] => {
  const found: string[] = [];
  walkDocumentSchemas(document, (schema, path) => {
    if (Object.keys(schema).length === 0) found.push(path);
  });
  return found;
};
