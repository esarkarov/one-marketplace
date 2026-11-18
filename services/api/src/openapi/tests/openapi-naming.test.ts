import { describe, expect, it } from "vitest";
import {
  apiRouter,
  identifyAccount,
  isAuthenticated,
  verifyBearerToken,
} from "../../routes/index.js";
import { createOpenApiDocument } from "../document.js";
import { isObject } from "../utils/json.utils.js";
import type { JsonObject } from "../types/openapi.types.js";

const CAMEL_CASE = /^[a-z][a-zA-Z0-9]*$/;

const SNAKE_CASE_OPERATIONS = new Set([
  "freelancer_get_profile",
  "freelancer_put_profile",
  "freelancer_get_profile_by_id",
  "agency_post_proposals",
  "proposals_post",
  "agency_get_connects_history",
  "connects_get_history",
  "messaging_get_by_conversation_id_messages",
  "messaging_post_by_conversation_id_messages",
  "notifications_get",
]);

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
  it.each(operations.filter(({ id }) => !SNAKE_CASE_OPERATIONS.has(id)))(
    "$id uses lowerCamelCase property names",
    ({ names }) => {
      expect(names.filter((name) => !CAMEL_CASE.test(name))).toEqual([]);
    },
  );

  it("lists only operations that still have a non-camelCase property", () => {
    const stale = [...SNAKE_CASE_OPERATIONS].filter((id) => {
      const operation = operations.find((item) => item.id === id);
      return !operation?.names.some((name) => !CAMEL_CASE.test(name));
    });

    expect(stale).toEqual([]);
  });
});
