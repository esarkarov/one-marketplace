import { afterEach, describe, expect, it, vi } from "vitest";

const load = async (env: Record<string, string | undefined>) => {
  vi.resetModules();
  vi.doMock("./env.js", () => ({ env }));
  return import("./cors.js");
};

const allows = (
  options: { origin: (...args: never[]) => void },
  origin: string | undefined,
) => {
  let result: boolean | undefined;
  (
    options.origin as unknown as (
      o: string | undefined,
      cb: (error: Error | null, allow?: boolean) => void,
    ) => void
  )(origin, (_error, allow) => {
    result = allow;
  });
  return result;
};

describe("cors", () => {
  afterEach(() => {
    vi.doUnmock("./env.js");
  });

  it("falls back to localhost origins outside production", async () => {
    const { allowedOrigins, corsOptions } = await load({
      nodeEnv: "development",
    });

    expect(allowedOrigins).toEqual([
      "http://localhost:3001",
      "http://localhost:3002",
      "http://localhost:3003",
      "http://localhost:3004",
    ]);
    expect(allows(corsOptions, "http://localhost:3001")).toBe(true);
  });

  it("has no fallback origins in production", async () => {
    const { allowedOrigins, corsOptions } = await load({
      nodeEnv: "production",
    });

    expect(allowedOrigins).toEqual([]);
    expect(allows(corsOptions, "http://localhost:3001")).toBe(false);
    expect(allows(corsOptions, undefined)).toBe(true);
  });

  it("uses configured origins in production", async () => {
    const { allowedOrigins, corsOptions } = await load({
      nodeEnv: "production",
      clientDashboard: "https://client.example.com/app",
    });

    expect(allowedOrigins).toEqual(["https://client.example.com"]);
    expect(allows(corsOptions, "https://client.example.com")).toBe(true);
    expect(allows(corsOptions, "https://evil.example.com")).toBe(false);
  });

  describe("production startup with real env parsing", () => {
    const production = {
      DATABASE_URL: "postgres://user:dbpass@localhost:5432/app",
      REDIS_URL: "redis://localhost:6379",
      NODE_ENV: "production",
      CLERK_SECRET_KEY: "sk_live_clerk",
      STRIPE_SECRET_KEY: "sk_live_stripe",
      STRIPE_WEBHOOK_SECRET: "whsec_a",
      STRIPE_CONNECTS_WEBHOOK_SECRET: "whsec_b",
      STRIPE_IDENTITY_WEBHOOK_SECRET: "whsec_c",
      ADMIN_DASHBOARD_PASSWORD: "a-strong-admin-password",
      ADMIN_SESSION_SECRET: "s".repeat(32),
    };

    it("fails when no dashboard origin is configured", async () => {
      vi.resetModules();
      const { parseEnv } = await import("./env.js");

      expect(() => parseEnv(production)).toThrow(/dashboard origin/);
    });

    it("fails on a non-http dashboard origin", async () => {
      vi.resetModules();
      const { parseEnv } = await import("./env.js");

      expect(() =>
        parseEnv({ ...production, CLIENT_DASHBOARD: "ftp://x.example.com" }),
      ).toThrow(/CLIENT_DASHBOARD/);
    });

    it("yields the configured origins when valid", async () => {
      vi.resetModules();
      const { parseEnv } = await import("./env.js");
      const parsed = parseEnv({
        ...production,
        CLIENT_DASHBOARD: "https://client.example.com/app",
      });
      const { allowedOrigins } = await load({
        nodeEnv: parsed.nodeEnv,
        clientDashboard: parsed.clientDashboard,
      });

      expect(allowedOrigins).toEqual(["https://client.example.com"]);
    });

    it("keeps the localhost fallback outside production", async () => {
      vi.resetModules();
      const { parseEnv } = await import("./env.js");
      const { allowedOrigins } = await load({
        nodeEnv: parseEnv({ ...production, NODE_ENV: "development" }).nodeEnv,
      });

      expect(allowedOrigins).toHaveLength(4);
    });
  });
});
