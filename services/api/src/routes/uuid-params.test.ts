import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  store: new Map<string, string>(),
  verifyToken: vi.fn(),
  accountRows: [] as unknown[],
}));

vi.mock("@clerk/backend", () => ({ verifyToken: mocks.verifyToken }));

vi.mock("../config/imageKit.js", () => ({
  imageKit: { files: { upload: vi.fn(), delete: vi.fn() } },
}));

vi.mock("../config/redis.js", () => ({
  redis: {
    get: async (key: string) => mocks.store.get(key) ?? null,
    expire: async () => true,
    setEx: async (key: string, _ttl: number, value: string) => {
      mocks.store.set(key, value);
      return "OK";
    },
  },
  connectRedis: async () => undefined,
  disconnectRedis: async () => undefined,
}));

vi.mock("../database/client.js", () => {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: async () => mocks.accountRows,
  };
  return {
    db: { select: () => chain },
    pool: { end: async () => undefined },
  };
});

const { app } = await import("../app.js");
const { apiRouter } = await import("./index.js");
const { collectRoutes, readMountPaths, routeKey, schemasOf } =
  await import("./route-validation-check.js");
const { validationAllowlist } = await import("./validation-allowlist.js");

const routes = collectRoutes(
  apiRouter,
  readMountPaths(readFileSync(new URL("./index.ts", import.meta.url), "utf8")),
);

const nonUuidParamExceptions: Record<
  string,
  { value: string; reason: string }
> = {
  "GET /admin/system/redis/keys/:key": {
    value: "not a key!",
    reason:
      "the param is a Redis key, not a UUID; the schema accepts [A-Za-z0-9:_-], so a value with spaces and punctuation is sent instead",
  },
};

const allowlisted = new Set(
  validationAllowlist.map((e) => routeKey(e.method, e.path)),
);
const paramRoutes = routes.filter(
  (r) => r.path.includes(":") && !allowlisted.has(routeKey(r.method, r.path)),
);

const adminSessionToken = () => {
  const expiresAt = String(Date.now() + 60_000);
  const signature = createHmac(
    "sha256",
    process.env.ADMIN_SESSION_SECRET as string,
  )
    .update(expiresAt)
    .digest("hex");
  return `${expiresAt}.${signature}`;
};

beforeEach(() => {
  mocks.store.clear();
  mocks.accountRows = [{ isOnboardingComplete: true }];
  mocks.verifyToken.mockReset();
  mocks.verifyToken.mockResolvedValue({ sub: "user_1", sid: "sess_1" });
});

const fill = (route: { method: string; path: string }) => {
  const key = routeKey(route.method, route.path);
  const exception = nonUuidParamExceptions[key];
  return route.path.replace(/:[A-Za-z]+/g, () =>
    encodeURIComponent(exception?.value ?? "not-a-uuid"),
  );
};

describe("non-UUID path params", () => {
  it("covers every route with a path param", () => {
    expect(paramRoutes.length).toBeGreaterThan(20);
    for (const route of paramRoutes) {
      expect(schemasOf(route)?.params).toBeDefined();
    }
    for (const key of Object.keys(nonUuidParamExceptions)) {
      expect(paramRoutes.map((r) => routeKey(r.method, r.path))).toContain(key);
    }
    for (const entry of Object.values(nonUuidParamExceptions)) {
      expect(entry.reason.trim()).not.toBe("");
    }
  });

  it.each(paramRoutes.map((r) => [routeKey(r.method, r.path), r] as const))(
    "%s answers 400 VALIDATION_ERROR",
    async (_key, route) => {
      const url = `/api/v1${fill(route)}`;
      const method = route.method.toLowerCase() as
        "get" | "post" | "put" | "patch" | "delete";
      const authorization = route.path.startsWith("/admin")
        ? `Bearer ${adminSessionToken()}`
        : "Bearer test-token";

      const response = await request(app)
        [method](url)
        .set({ Authorization: authorization })
        .query(route.path.startsWith("/admin") ? {} : { role: "client" })
        .send({});

      expect(response.status, JSON.stringify(response.body)).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
      const paths = (response.body.errors as { path: string }[]).map(
        (error) => error.path,
      );
      expect(paths.some((path) => path.startsWith("params."))).toBe(true);
    },
  );
});
