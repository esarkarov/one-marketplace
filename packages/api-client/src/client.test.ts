import { describe, expect, it } from "vitest";
import { createApiClient, type ApiClientOptions } from "./index";

const ok = () =>
  new Response(JSON.stringify({ success: true, message: "OK", data: {} }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const setup = (options: Partial<ApiClientOptions> = {}) => {
  const requests: Request[] = [];
  const bodies: string[] = [];
  const client = createApiClient({
    baseUrl: "http://api.test",
    getToken: async () => "tok_secret",
    fetch: (async (input: Request) => {
      requests.push(input);
      bodies.push(await input.clone().text());
      return ok();
    }) as unknown as typeof fetch,
    ...options,
  });
  const last = () => new URL(requests[requests.length - 1]!.url);
  return { client, requests, bodies, last };
};

describe("authorization", () => {
  it("sends the bearer token when getToken returns one", async () => {
    const { client, requests } = setup();
    await client.GET("/api/v1/health");

    expect(requests[0]!.headers.get("authorization")).toBe("Bearer tok_secret");
  });

  it("sends no authorization header when getToken returns null", async () => {
    const { client, requests } = setup({ getToken: async () => null });
    await client.GET("/api/v1/health");

    expect(requests[0]!.headers.has("authorization")).toBe(false);
  });

  it("still sends the bearer on POST /auth/sign-up and leaves the body alone", async () => {
    const { client, requests, bodies, last } = setup({
      getRole: () => "client",
    });
    await client.POST("/api/v1/auth/sign-up", { body: { role: "freelancer" } });

    expect(requests[0]!.headers.get("authorization")).toBe("Bearer tok_secret");
    expect(last().searchParams.has("role")).toBe(false);
    expect(JSON.parse(bodies[0]!)).toEqual({ role: "freelancer" });
  });
});

describe("role injection", () => {
  it.each([
    [
      "GET /api/v1/auth/status",
      (c: ReturnType<typeof setup>["client"]) =>
        c.GET("/api/v1/auth/status", { params: { query: {} } }),
    ],
    [
      "GET /api/v1/freelancer/jobs",
      (c: ReturnType<typeof setup>["client"]) =>
        c.GET("/api/v1/freelancer/jobs", { params: { query: {} } }),
    ],
  ])("adds role for %s", async (_name, call) => {
    const { client, last } = setup({ getRole: () => "freelancer" });
    await call(client);

    expect(last().searchParams.get("role")).toBe("freelancer");
  });

  it.each([
    [
      "GET /api/v1/jobs/public",
      (c: ReturnType<typeof setup>["client"]) => c.GET("/api/v1/jobs/public"),
    ],
    [
      "GET /api/v1/health",
      (c: ReturnType<typeof setup>["client"]) => c.GET("/api/v1/health"),
    ],
  ])("never adds role or scope for the public %s", async (_name, call) => {
    const { client, last } = setup({
      getRole: () => "client",
      getScope: () => "agency",
    });
    await call(client);

    expect(last().searchParams.has("role")).toBe(false);
    expect(last().searchParams.has("scope")).toBe(false);
  });

  it("adds nothing when getRole returns undefined", async () => {
    const { client, last } = setup({ getRole: () => undefined });
    await client.GET("/api/v1/auth/status", { params: { query: {} } });

    expect(last().searchParams.has("role")).toBe(false);
  });

  it("does not override a role the caller passed", async () => {
    const { client, last } = setup({ getRole: () => "client" });
    await client.GET("/api/v1/auth/status", {
      params: { query: { role: "freelancer" } },
    });

    expect(last().searchParams.getAll("role")).toEqual(["freelancer"]);
  });

  it("keeps the JSON body of a role-in-body operation untouched and adds the query role", async () => {
    const { client, bodies, last } = setup({ getRole: () => "client" });
    await client.POST("/api/v1/jobs", {
      params: { query: {} },
      body: { role: "client" } as never,
    });

    expect(last().searchParams.get("role")).toBe("client");
    expect(JSON.parse(bodies[0]!)).toEqual({ role: "client" });
  });
});

describe("scope injection", () => {
  it("adds scope=agency only for scope operations and only when asked", async () => {
    const { client, last } = setup({
      getRole: () => "freelancer",
      getScope: () => "agency",
    });

    await client.GET("/api/v1/notifications", { params: { query: {} } });
    expect(last().searchParams.get("scope")).toBe("agency");
    expect(last().searchParams.get("role")).toBe("freelancer");

    await client.GET("/api/v1/auth/status", { params: { query: {} } });
    expect(last().searchParams.has("scope")).toBe(false);
  });

  it("adds no scope when getScope returns undefined", async () => {
    const { client, last } = setup({
      getRole: () => "freelancer",
      getScope: () => undefined,
    });
    await client.GET("/api/v1/notifications", { params: { query: {} } });

    expect(last().searchParams.has("scope")).toBe(false);
  });
});

describe("base url", () => {
  it("accepts an origin with a trailing /api/v1", async () => {
    const { client, last } = setup({ baseUrl: "http://api.test/api/v1/" });
    await client.GET("/api/v1/health");

    expect(last().href).toBe("http://api.test/api/v1/health");
  });
});
