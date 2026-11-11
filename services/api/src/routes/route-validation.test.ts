import { readFileSync } from "node:fs";
import { Router } from "express";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { withIgnoredKeys } from "../utils/common-schemas.js";
import { validate } from "../middleware/validate.middleware.js";
import { apiRouter } from "./index.js";
import {
  collectRoutes,
  findStaleEntries,
  findViolations,
  readMountPaths,
  routeKey,
} from "./route-validation-check.js";
import {
  bodylessRoutes,
  publicRoutes,
  validationAllowlist,
} from "./validation-allowlist.js";

const mountPaths = readMountPaths(
  readFileSync(new URL("./index.ts", import.meta.url), "utf8"),
);
const routes = collectRoutes(apiRouter, mountPaths);
const noop = () => undefined;
const auth = () => undefined;

describe("apiRouter route walk", () => {
  it("finds every mounted module and the health routes", () => {
    const keys = routes.map((r) => routeKey(r.method, r.path));

    expect(routes.length).toBeGreaterThan(50);
    expect(keys).toContain("GET /health");
    expect(keys).toContain("GET /ready");
    expect(keys).toContain("POST /agency");
    expect(keys).toContain("PATCH /contracts/:contractId/accept");
    for (const mount of mountPaths) {
      expect(
        routes.some((r) => r.path === mount || r.path.startsWith(`${mount}/`)),
      ).toBe(true);
    }
  });
});

describe("route validation coverage", () => {
  it("requires params, query and body schemas on every route", () => {
    expect(
      findViolations(routes, validationAllowlist, bodylessRoutes, publicRoutes),
    ).toEqual([]);
  });

  it("keeps the allowlist to the four webhooks", () => {
    expect(
      validationAllowlist.map((e) => routeKey(e.method, e.path)).sort(),
    ).toEqual([
      "POST /connects/webhook",
      "POST /contracts/webhook",
      "POST /identity/webhook",
      "POST /meetings/webhook",
    ]);
  });

  it("has no stale entries and a reason for each", () => {
    const entries = [...validationAllowlist, ...bodylessRoutes];

    expect(findStaleEntries(routes, entries)).toEqual([]);
    for (const entry of entries) {
      expect(entry.reason.trim()).not.toBe("");
    }
  });

  it("can fail on routes without validate", () => {
    const router = Router();
    router.get("/ok", auth, validate({ query: {} }), noop);
    router.get("/bare", noop);
    router.post("/items/:id", auth, validate({ params: {}, query: {} }), noop);
    router.get("/items/:id", auth, validate({ query: {} }), noop);
    const nested = Router();
    nested.put("/x", auth, validate({ query: {} }), noop);
    router.use("/nested", nested);

    const found = collectRoutes(router, ["/nested"]);

    expect(findViolations(found, [], [])).toEqual([
      "GET /bare: no validate() handler",
      "POST /items/:id: missing body schema",
      "GET /items/:id: missing params schema",
      "PUT /nested/x: missing body schema",
    ]);
  });

  it("reports stale allowlist entries", () => {
    expect(
      findStaleEntries(routes, [
        { method: "POST", path: "/nope/webhook", reason: "x" },
      ]),
    ).toEqual(["POST /nope/webhook"]);
  });
});

describe("route validation order and shape checks", () => {
  const found = (build: (router: Router) => void) => {
    const router = Router();
    build(router);
    return collectRoutes(router, []);
  };

  it("fails when validate runs first on a non-public route", () => {
    const routes = found((r) => r.get("/a", validate({ query: {} }), noop));

    expect(findViolations(routes, [], [])).toEqual([
      "GET /a: validate() runs before any auth middleware",
    ]);
    expect(
      findViolations(
        routes,
        [],
        [],
        [{ method: "GET", path: "/a", reason: "x" }],
      ),
    ).toEqual([]);
  });

  it("counts router-level middleware as running before validate", () => {
    const routes = found((r) => {
      r.use(auth);
      r.get("/a", validate({ query: {} }), noop);
    });

    expect(findViolations(routes, [], [])).toEqual([]);
  });

  it("fails when validate is the last handler", () => {
    const routes = found((r) =>
      r.get("/a", auth, noop, validate({ query: {} })),
    );

    expect(findViolations(routes, [], [])).toEqual([
      "GET /a: validate() must run before the last handler",
    ]);
  });

  it.each([
    ["z.any()", z.any()],
    ["z.record()", z.record(z.string(), z.string())],
    ["a loose object", z.looseObject({})],
    ["a stripping object", z.object({})],
  ])("fails for %s", (_name, schema) => {
    const routes = found((r) =>
      r.get("/a", auth, validate({ query: schema }), noop),
    );

    expect(findViolations(routes, [], [])).toHaveLength(1);
  });

  it("accepts strict objects, ignored keys and preprocess wrappers", () => {
    const routes = found((r) => {
      r.post(
        "/a",
        auth,
        validate({
          query: z.strictObject({}),
          body: withIgnoredKeys({ a: z.string() }, ["id"]),
        }),
        noop,
      );
      r.post(
        "/b",
        auth,
        validate({
          query: {},
          body: z.preprocess((v) => v ?? {}, z.strictObject({})),
        }),
        noop,
      );
    });

    expect(findViolations(routes, [], [])).toEqual([]);
  });

  it("throws on a pathless nested router", () => {
    const router = Router();
    const nested = Router();
    nested.get("/x", auth, validate({ query: {} }), noop);
    router.use(nested);

    expect(() => collectRoutes(router, ["/a", "/b"])).toThrow(/without a path/);
  });
});
