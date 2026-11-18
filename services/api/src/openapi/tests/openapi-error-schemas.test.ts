import { describe, expect, it } from "vitest";
import { apiRouter } from "../../routes/index.js";
import { createOpenApiDocument } from "../document.js";
import { isObject } from "../utils/json.utils.js";
import type { JsonObject } from "../types/openapi.types.js";
import {
  identifyAccount,
  isAuthenticated,
  verifyBearerToken,
} from "../../routes/index.js";

const document = createOpenApiDocument(apiRouter, [
  isAuthenticated,
  identifyAccount,
  verifyBearerToken,
]);
const METHODS = ["get", "post", "put", "patch", "delete"];

const resolve = (node: unknown): JsonObject => {
  let current = node;
  while (isObject(current) && typeof current.$ref === "string") {
    let target: unknown = document;
    for (const part of current.$ref.replace(/^#\//, "").split("/")) {
      target = isObject(target) ? target[part] : undefined;
    }
    current = target;
  }
  if (!isObject(current)) throw new Error("Unresolved reference.");
  return current;
};

const branches = (schema: JsonObject): JsonObject[] => {
  const union = schema.oneOf ?? schema.anyOf;
  return Array.isArray(union)
    ? union.flatMap((item) => branches(resolve(item)))
    : [schema];
};

interface ErrorSchema {
  label: string;
  schema: JsonObject;
}

const collectErrorSchemas = (): ErrorSchema[] => {
  const found: ErrorSchema[] = [];
  const paths = document.paths as Record<string, JsonObject>;

  for (const [path, item] of Object.entries(paths)) {
    for (const method of METHODS) {
      const operation = item[method];
      if (!isObject(operation) || !isObject(operation.responses)) continue;

      for (const [status, rawResponse] of Object.entries(operation.responses)) {
        if (!/^[45]/.test(status)) continue;
        const response = resolve(rawResponse);
        const content = response.content;
        const json = isObject(content) ? content["application/json"] : null;
        const schema = isObject(json) ? json.schema : null;
        if (!schema) continue;

        for (const branch of branches(resolve(schema))) {
          found.push({
            label: `${method.toUpperCase()} ${path} ${status}`,
            schema: branch,
          });
        }
      }
    }
  }

  return found;
};

describe("openapi error responses", () => {
  const errorSchemas = collectErrorSchemas();

  it("covers every 4xx and 5xx response with a JSON body", () => {
    expect(errorSchemas.length).toBeGreaterThan(100);
  });

  it.each(errorSchemas.map((entry) => [entry.label, entry.schema] as const))(
    "%s requires code and requestId",
    (_label, schema) => {
      const required = Array.isArray(schema.required) ? schema.required : [];
      const properties = isObject(schema.properties) ? schema.properties : {};

      expect(required).toContain("success");
      expect(required).toContain("message");
      expect(required).toContain("code");
      expect(required).toContain("requestId");
      expect(properties).toHaveProperty("code");
      expect(properties).toHaveProperty("requestId");
    },
  );
});
