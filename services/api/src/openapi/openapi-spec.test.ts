import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { env, parseEnv } from "../config/env.js";
import { apiRouter } from "../routes/index.js";
import { contractAllowlist } from "../routes/contract-allowlist.js";
import { routeKey } from "../routes/route-validation-check.js";
import { publicRoutes } from "../routes/validation-allowlist.js";
import {
  CONTROLLER_AUTH_OVERRIDES,
  DEFAULT_PORT,
  toOpenApiPath,
} from "./build-spec.js";
import {
  OPENAPI_FILE,
  collectApiRoutes,
  createOpenApiDocument,
  createOpenApiText,
} from "./document.js";
import {
  findEmptySchemas,
  isObject,
  walkDocumentSchemas,
  walkSchema,
  type Json,
  type JsonObject,
} from "./schema-walk.js";

const METHODS = ["get", "post", "put", "patch", "delete"];
const routes = collectApiRoutes(apiRouter);
const document = createOpenApiDocument(apiRouter);
const paths = document.paths as Record<string, JsonObject>;
const schemas = (document.components as JsonObject).schemas as Record<
  string,
  JsonObject
>;

const operations = Object.entries(paths).flatMap(([path, item]) =>
  Object.entries(item)
    .filter(([method]) => METHODS.includes(method))
    .map(([method, operation]) => ({
      key: `${method.toUpperCase()} ${path}`,
      path,
      method,
      operation: operation as JsonObject,
    })),
);

const MONEY_NAME =
  /(amount|total|price|earning|balance|spent|fee|budget|rate|available|pending|lifetime)/i;

const MONEY_NAME_ALLOWLIST: Readonly<Record<string, string>> = {
  amount:
    "connects count (connects_history.amount is a connects delta), not money",
  availableAt: "timestamp when an earning becomes available",
  feeRatePercent: "percentage, not money",
  heapTotal: "bytes of process memory",
  hireRate: "integer percentage of jobs that led to a hire",
  hasEarnings: "boolean flag",
  is_available: "boolean flag on a message attachment",
  recentEarnings: "array of items; its money fields are named *Cents",
  total: "count of proposals",
  totalContracts: "count",
  totalHires: "count",
  totalMemoryMb: "process memory in megabytes",
  totalProposals: "count",
  totals: "object of entity counts",
  totalUnread: "count of unread messages",
};

const isCentsName = (name: string) => /(Cents|_cents)$/.test(name);

const resolve = (schema: JsonObject): JsonObject => {
  const ref = schema.$ref;
  if (typeof ref !== "string") return schema;
  const target = schemas[ref.slice("#/components/schemas/".length)];
  if (!target) throw new Error(`Unresolved reference ${ref}`);
  return target;
};

const isIntegerLike = (schema: JsonObject): boolean => {
  const target = resolve(schema);
  if (target.type === "integer") return true;
  if (Array.isArray(target.type)) {
    return (
      target.type.includes("integer") &&
      target.type.every((type) => type === "integer" || type === "null")
    );
  }
  const variants = target.anyOf ?? target.oneOf;
  if (Array.isArray(variants)) {
    const objects = variants.filter(isObject);
    return (
      objects.some(isIntegerLike) &&
      objects.every(
        (variant) => variant.type === "null" || isIntegerLike(variant),
      )
    );
  }
  return false;
};

const collectRefs = (node: Json, found: Set<string>) => {
  if (Array.isArray(node)) {
    node.forEach((item) => collectRefs(item, found));
  } else if (isObject(node)) {
    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref" && typeof value === "string") found.add(value);
      else collectRefs(value, found);
    }
  }
};

describe("openapi document", () => {
  it("matches the committed docs/api/openapi.json", () => {
    const committed = readFileSync(OPENAPI_FILE, "utf8");

    expect(
      createOpenApiText(apiRouter) === committed,
      "docs/api/openapi.json is out of date; run `pnpm --filter @onemarketplace/api openapi:generate` and commit the result.",
    ).toBe(true);
  });

  it("uses OpenAPI 3.1.0 with the local server only", () => {
    expect(document.openapi).toBe("3.1.0");
    expect(document.servers).toEqual([
      { url: `http://localhost:${DEFAULT_PORT}` },
    ]);
    expect(
      parseEnv({ DATABASE_URL: "postgres://x", REDIS_URL: "redis://x" }).port,
    ).toBe(DEFAULT_PORT);
    expect(env.port).toBeGreaterThan(0);
  });

  it("has an operation for every route and a route for every operation", () => {
    const expected = routes.map(
      (route) => `${route.method} ${toOpenApiPath(route.path)}`,
    );

    expect(operations.map((o) => o.key).sort()).toEqual(expected.sort());
    expect(new Set(expected).size).toBe(expected.length);
  });

  it("resolves every $ref", () => {
    const refs = new Set<string>();
    collectRefs(document, refs);

    expect(refs.size).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref.startsWith("#/components/schemas/"), ref).toBe(true);
      expect(
        schemas[ref.slice("#/components/schemas/".length)],
        `${ref} does not resolve`,
      ).toBeDefined();
    }
  });

  it("has unique operationIds", () => {
    const ids = operations.map((o) => o.operation.operationId);

    expect(ids.every((id) => typeof id === "string" && id !== "")).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("declares security, responses, 429 and 500 on every operation", () => {
    for (const { key, operation } of operations) {
      expect(Array.isArray(operation.security), `${key} security`).toBe(true);
      const responses = operation.responses as JsonObject;
      expect(isObject(responses), `${key} responses`).toBe(true);
      expect(responses["429"], `${key} 429`).toBeDefined();
      expect(responses["500"], `${key} 500`).toBeDefined();
      if ((operation.security as Json[]).length > 0) {
        expect(responses["401"], `${key} 401`).toBeDefined();
      }
    }
  });

  it("only leaves signature-verified, public or login routes without security", () => {
    const open = new Set([
      ...publicRoutes.map((e) => routeKey(e.method, e.path)),
      ...contractAllowlist.rawBodyWebhooks.map((e) =>
        routeKey(e.method, e.path),
      ),
      "POST /admin/auth/login",
      "GET /freelancer/search",
      "GET /agency/search",
    ]);
    const openOperations = new Set(
      routes
        .filter((route) => open.has(routeKey(route.method, route.path)))
        .map((route) => `${route.method} ${toOpenApiPath(route.path)}`),
    );

    for (const { key, operation } of operations) {
      const isOpen = (operation.security as Json[]).length === 0;
      expect(isOpen, key).toBe(openOperations.has(key));
    }
  });

  it("matches every controller auth override to a real route", () => {
    const keys = new Set(
      routes.map((route) => routeKey(route.method, route.path)),
    );

    for (const [key, override] of Object.entries(CONTROLLER_AUTH_OVERRIDES)) {
      expect(keys.has(key), `${key} is not a route`).toBe(true);
      expect(override.reason.trim(), key).not.toBe("");
      const [method, path] = key.split(" ") as [string, string];
      const operation = operations.find(
        (o) => o.key === `${method} ${toOpenApiPath(path)}`,
      );
      expect(operation?.operation.security, key).toEqual([
        { [override.scheme]: [] },
      ]);
    }
  });

  it("marks role required on Clerk-secured operations that declare it", () => {
    let checked = 0;
    for (const { key, operation } of operations) {
      const security = operation.security as JsonObject[];
      const clerk = security.some((item) => "clerkBearer" in item);
      for (const parameter of (operation.parameters ?? []) as JsonObject[]) {
        if (parameter.in === "query" && parameter.name === "role") {
          checked += 1;
          expect(parameter.required, key).toBe(clerk);
        }
      }
    }

    expect(checked).toBeGreaterThan(0);
  });

  it("declares every path template parameter", () => {
    for (const { key, path, operation } of operations) {
      const declared = new Set(
        ((operation.parameters ?? []) as JsonObject[])
          .filter((parameter) => parameter.in === "path")
          .map((parameter) => parameter.name),
      );
      for (const match of path.matchAll(/\{(\w+)\}/g)) {
        expect(declared.has(match[1]), `${key} {${match[1]}}`).toBe(true);
      }
      for (const parameter of (operation.parameters ?? []) as JsonObject[]) {
        if (parameter.in === "path") expect(parameter.required).toBe(true);
      }
    }
  });

  it("has no empty schemas", () => {
    expect(findEmptySchemas(document)).toEqual([]);
  });

  it("types every Cents property as an integer", () => {
    let checked = 0;
    walkDocumentSchemas(document, (schema, path, name) => {
      if (name === undefined || !isCentsName(name)) return;
      checked += 1;
      expect(isIntegerLike(schema), `${path} must be an integer`).toBe(true);
    });

    expect(checked).toBeGreaterThan(20);
  });

  it("does not expose money-like response properties without a Cents name", () => {
    const names = new Map<string, string>();
    const seen = new Set<string>();
    const pending = new Set<string>();
    const note = (
      schema: JsonObject,
      path: string,
      name: string | undefined,
    ) => {
      if (name !== undefined && !names.has(name)) names.set(name, path);
      if (typeof schema.$ref === "string") pending.add(schema.$ref);
    };

    walkDocumentSchemas(document, (schema, path, name, kind) => {
      if (kind === "response") note(schema, path, name);
    });

    for (const ref of pending) {
      if (seen.has(ref)) continue;
      seen.add(ref);
      walkSchema(schemas[ref.slice("#/components/schemas/".length)], ref, note);
    }

    const hits = [...names]
      .filter(([name]) => MONEY_NAME.test(name) && !isCentsName(name))
      .filter(([name]) => !(name in MONEY_NAME_ALLOWLIST))
      .map(([name, path]) => `${name} (${path})`);

    expect(hits).toEqual([]);
    for (const [name, reason] of Object.entries(MONEY_NAME_ALLOWLIST)) {
      expect(reason.trim(), name).not.toBe("");
      expect(names.has(name), `${name} is allowlisted but unused`).toBe(true);
    }
  });
});
