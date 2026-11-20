import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  operationsWithBodyRole,
  operationsWithRole,
  operationsWithScope,
} from "./generated/meta";

const read = (relative: string) =>
  readFileSync(new URL(relative, import.meta.url));

const specBytes = read("../../../docs/api/openapi.json");
const specHash = createHash("sha256").update(specBytes).digest("hex");
const spec = JSON.parse(specBytes.toString("utf8")) as {
  paths: Record<string, Record<string, Operation>>;
};

interface Operation {
  parameters?: Array<{ in: string; name: string }>;
  requestBody?: {
    content?: Record<string, { schema?: { properties?: object } }>;
  };
}

const HTTP = new Set(["get", "put", "post", "delete", "patch"]);

const operations = Object.entries(spec.paths).flatMap(([path, item]) =>
  Object.entries(item)
    .filter(([method]) => HTTP.has(method))
    .map(([method, operation]) => ({
      key: `${method.toUpperCase()} ${path}`,
      operation,
    })),
);

const keysWhere = (test: (operation: Operation) => boolean) =>
  operations
    .filter(({ operation }) => test(operation))
    .map(({ key }) => key)
    .sort();

const hasQuery = (name: string) => (operation: Operation) =>
  (operation.parameters ?? []).some(
    (parameter) => parameter.in === "query" && parameter.name === name,
  );

describe("generated files", () => {
  it.each(["./generated/schema.ts", "./generated/meta.ts"])(
    "%s matches the OpenAPI document",
    (file) => {
      const text = read(file.replace("./", "./")).toString("utf8");
      const header = /openapi-sha256: ([0-9a-f]{64})/.exec(text);

      expect(text.startsWith("/**\n * DO NOT EDIT")).toBe(true);
      expect(
        header?.[1],
        "The generated API client files are stale. Run `pnpm -C packages/api-client generate` and commit the result.",
      ).toBe(specHash);
    },
  );
});

describe("operation metadata", () => {
  it("lists exactly the nine scope operations the spec declares", () => {
    const expected = keysWhere(hasQuery("scope"));

    expect(expected).toHaveLength(9);
    expect([...operationsWithScope].sort()).toEqual(expected);
  });

  it("lists exactly the operations that declare a role query parameter", () => {
    const expected = keysWhere(hasQuery("role"));

    expect(expected.length).toBeGreaterThan(0);
    expect([...operationsWithRole].sort()).toEqual(expected);
  });

  it("lists role-in-body operations and keeps public ones out of every set", () => {
    const expected = keysWhere((operation) =>
      Object.hasOwn(
        operation.requestBody?.content?.["application/json"]?.schema
          ?.properties ?? {},
        "role",
      ),
    );

    expect([...operationsWithBodyRole].sort()).toEqual(expected);
    expect(operationsWithBodyRole.has("POST /api/v1/auth/sign-up")).toBe(true);
    expect(operationsWithRole.has("POST /api/v1/auth/sign-up")).toBe(false);

    for (const key of [
      "GET /api/v1/jobs/public",
      "GET /api/v1/health",
      "GET /api/v1/freelancer/search",
    ]) {
      expect(operationsWithRole.has(key)).toBe(false);
      expect(operationsWithScope.has(key)).toBe(false);
    }
  });
});
