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

const UPPER_SNAKE = /^[A-Z][A-Z0-9_]*$/;

const READINESS_OPERATION = "system_get_ready";
const SELECTOR_PROPERTY = "role";

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

interface Finding {
  path: string;
  property: string;
  schema: JsonObject;
}

const collect = (
  node: unknown,
  path: string,
  property: string,
  out: Finding[],
  visited: Set<string>,
) => {
  if (Array.isArray(node)) {
    for (const item of node) collect(item, path, property, out, visited);
    return;
  }
  if (!isObject(node)) return;

  const ref = node.$ref;
  if (typeof ref === "string") {
    const name = ref.split("/").pop() ?? "";
    if (visited.has(name)) return;
    visited.add(name);
    out.push({ path, property, schema: { $ref: ref } });
    collect(schemas[name], path, property, out, visited);
    return;
  }

  out.push({ path, property, schema: node });
  if (isObject(node.properties)) {
    for (const [name, child] of Object.entries(node.properties)) {
      collect(child, `${path}.${name}`, name, out, visited);
    }
  }
  for (const [key, value] of Object.entries(node)) {
    if (key !== "properties") collect(value, path, property, out, visited);
  }
};

const operations = Object.values(document.paths as Record<string, JsonObject>)
  .flatMap((item) => METHODS.map((method) => item[method]))
  .filter(isObject)
  .map((operation) => {
    const request: Finding[] = [];
    const response: Finding[] = [];
    collect(operation.requestBody, "request", "", request, new Set());
    collect(operation.responses, "response", "", response, new Set());
    return { id: String(operation.operationId), request, response };
  });

const stringEnums = (findings: Finding[]) =>
  findings.filter(
    ({ schema }) =>
      Array.isArray(schema.enum) &&
      schema.enum.every((value) => typeof value === "string"),
  );

describe("openapi enum values", () => {
  it("inspects the enums and statuses of the document", () => {
    const all = operations.flatMap(({ request, response }) => [
      ...request,
      ...response,
    ]);

    expect(stringEnums(all).length).toBeGreaterThan(20);
    expect(
      all.filter(({ property }) => property === "status").length,
    ).toBeGreaterThan(20);
  });

  it.each(operations.filter(({ id }) => id !== READINESS_OPERATION))(
    "$id uses UPPER_SNAKE string enums on body properties",
    ({ request, response }) => {
      const offenders = stringEnums([...request, ...response])
        .filter(({ property }) => property !== SELECTOR_PROPERTY)
        .flatMap(({ path, schema }) =>
          (schema.enum as string[])
            .filter((value) => !UPPER_SNAKE.test(value))
            .map((value) => `${path} = ${value}`),
        );

      expect(offenders).toEqual([]);
    },
  );

  it.each(operations)(
    "$id constrains every response status",
    ({ response }) => {
      const unconstrained = response
        .filter(
          ({ property, schema }) =>
            property === "status" &&
            typeof schema.$ref !== "string" &&
            !("enum" in schema) &&
            !("const" in schema),
        )
        .map(({ path }) => path);

      expect(unconstrained).toEqual([]);
    },
  );
});
