import { describe, expect, it } from "vitest";
import {
  apiRouter,
  identifyAccount,
  isAuthenticated,
  verifyBearerToken,
} from "@/routes/index.js";
import { createOpenApiDocument } from "@/openapi/document.js";
import { isObject } from "@/openapi/utils/json.utils.js";
import type { JsonObject } from "@/openapi/types/openapi.types.js";

const CAMEL_CASE = /^[a-z][a-zA-Z0-9]*$/;

const METHODS = ["get", "post", "put", "patch", "delete"];

const document = createOpenApiDocument(apiRouter, [
  isAuthenticated,
  identifyAccount,
  verifyBearerToken,
]);
const schemas = (document.components as JsonObject).schemas as Record<
  string,
  JsonObject
>;

const collectPropertyNames = (
  node: unknown,
  names: Set<string>,
  visited: Set<string>,
) => {
  if (Array.isArray(node)) {
    for (const item of node) collectPropertyNames(item, names, visited);
    return;
  }
  if (!isObject(node)) return;

  const ref = node.$ref;
  if (typeof ref === "string") {
    const name = ref.split("/").pop() ?? "";
    if (visited.has(name)) return;
    visited.add(name);
    collectPropertyNames(schemas[name], names, visited);
    return;
  }

  if (isObject(node.properties)) {
    for (const name of Object.keys(node.properties)) names.add(name);
  }
  for (const value of Object.values(node)) {
    collectPropertyNames(value, names, visited);
  }
};

const operations = Object.values(document.paths as Record<string, JsonObject>)
  .flatMap((item) => METHODS.map((method) => item[method]))
  .filter(isObject)
  .map((operation) => {
    const names = new Set<string>();
    const visited = new Set<string>();
    collectPropertyNames(operation.requestBody, names, visited);
    collectPropertyNames(operation.responses, names, visited);
    return { id: String(operation.operationId), names: [...names] };
  });

describe("openapi property naming", () => {
  it.each(operations)("$id uses lowerCamelCase property names", ({ names }) => {
    expect(names.filter((name) => !CAMEL_CASE.test(name))).toEqual([]);
  });
});
