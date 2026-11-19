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

const FORBIDDEN = new Set(["authId", "auth_id", "clerkId", "clerk_id"]);

const METHODS = ["get", "post", "put", "patch", "delete"];

const EXEMPT: Record<string, { property: string; reason: string }> = {
  admin_get_accounts: {
    property: "authId",
    reason:
      "the one documented place that shows the Clerk id, for support lookups",
  },
};

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
    const parameters = Array.isArray(operation.parameters)
      ? operation.parameters.filter(isObject).map((p) => String(p.name))
      : [];
    return {
      id: String(operation.operationId),
      names: [...names, ...parameters],
    };
  });

describe("openapi Clerk id guard", () => {
  it.each(operations)("$id exposes no Clerk id property", ({ id, names }) => {
    const allowed = EXEMPT[id]?.property;
    expect(
      names.filter((name) => FORBIDDEN.has(name) && name !== allowed),
    ).toEqual([]);
  });

  it("keeps the single documented exemption in place", () => {
    expect(Object.keys(EXEMPT)).toEqual(["admin_get_accounts"]);
    const accounts = operations.find(
      (operation) => operation.id === "admin_get_accounts",
    );
    expect(accounts?.names).toContain("authId");
  });
});
