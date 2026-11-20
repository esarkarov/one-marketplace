import { describe, expect, it } from "vitest";
import { loginErrorMessage } from "./login-message";
import {
  handleLogin,
  handleLogout,
  proxyLogStream,
  proxyRedisKey,
  proxyRedisKeys,
  proxySystemHealth,
} from "./handlers";

const BASE_URL = "http://api.test/api/v1";
const NOW = Date.parse("2026-11-20T10:00:00.000Z");
const SECRET_TOKEN = "super-secret-session-token";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const okEnvelope = (data: unknown) => ({ success: true, message: "OK", data });

const errorEnvelope = (code: string, message: string, requestId?: string) => ({
  success: false,
  code,
  message,
  ...(requestId ? { requestId } : {}),
});

function recordingFetch(
  respond: (request: Request) => Response | Promise<Response>,
) {
  const requests: Request[] = [];
  const fetchFake = (async (input: Request) => {
    requests.push(input);
    return respond(input);
  }) as unknown as typeof fetch;
  return { fetch: fetchFake, requests };
}

const loginSuccess = (expiresAt: unknown) =>
  json(200, okEnvelope({ token: SECRET_TOKEN, expiresAt }));

describe("handleLogin", () => {
  it("stores the API token in a strict httpOnly cookie and never returns it", async () => {
    const { fetch, requests } = recordingFetch(() =>
      loginSuccess(new Date(NOW + 7_200_000).toISOString()),
    );
    const result = await handleLogin({
      body: { password: "pw" },
      baseUrl: BASE_URL,
      fetch,
      production: true,
      now: NOW,
    });

    expect(result.status).toBe(200);
    expect(result.cookie).toEqual({
      name: "admin_session",
      value: SECRET_TOKEN,
      options: {
        httpOnly: true,
        sameSite: "strict",
        secure: true,
        path: "/",
        maxAge: 7200,
      },
    });
    expect(JSON.stringify(result.body)).not.toContain(SECRET_TOKEN);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("http://api.test/api/v1/admin/auth/login");
    expect(requests[0]?.method).toBe("POST");
    expect(await requests[0]?.json()).toEqual({ password: "pw" });
    expect(requests[0]?.headers.get("authorization")).toBeNull();
  });

  it("passes a wrong password through as 401 without a cookie", async () => {
    const { fetch } = recordingFetch(() =>
      json(401, errorEnvelope("UNAUTHORIZED", "Incorrect password.", "req-1")),
    );
    const result = await handleLogin({
      body: { password: "nope" },
      baseUrl: BASE_URL,
      fetch,
      production: false,
      now: NOW,
    });
    expect(result.status).toBe(401);
    expect(result.cookie).toBeUndefined();
    expect(result.body).toMatchObject({
      success: false,
      message: "Incorrect password.",
      requestId: "req-1",
    });
  });

  it("passes a rate limit through as 429", async () => {
    const { fetch } = recordingFetch(() =>
      json(429, errorEnvelope("RATE_LIMITED", "Too many attempts.")),
    );
    const result = await handleLogin({
      body: { password: "x" },
      baseUrl: BASE_URL,
      fetch,
      production: false,
    });
    expect(result.status).toBe(429);
    expect(result.cookie).toBeUndefined();
  });

  it.each([
    ["missing", undefined],
    ["invalid", "tomorrow"],
    ["in the past", new Date(NOW - 1000).toISOString()],
  ])(
    "answers 502 and sets no cookie when expiresAt is %s",
    async (_n, expiresAt) => {
      const { fetch } = recordingFetch(() => loginSuccess(expiresAt));
      const result = await handleLogin({
        body: { password: "pw" },
        baseUrl: BASE_URL,
        fetch,
        production: false,
        now: NOW,
      });
      expect(result.status).toBe(502);
      expect(result.cookie).toBeUndefined();
      expect(JSON.stringify(result.body)).not.toContain(SECRET_TOKEN);
    },
  );

  it("answers 502 when the API is unreachable", async () => {
    const fetchFake = (async () => {
      throw new TypeError("connect ECONNREFUSED");
    }) as unknown as typeof fetch;
    const result = await handleLogin({
      body: { password: "pw" },
      baseUrl: BASE_URL,
      fetch: fetchFake,
      production: false,
    });
    expect(result.status).toBe(502);
    expect(result.cookie).toBeUndefined();
  });

  it("rejects a body without a password without calling the API", async () => {
    const { fetch, requests } = recordingFetch(() => loginSuccess("x"));
    for (const body of [null, {}, { password: 5 }, { password: "" }]) {
      const result = await handleLogin({
        body,
        baseUrl: BASE_URL,
        fetch,
        production: false,
      });
      expect(result.status).toBe(400);
    }
    expect(requests).toHaveLength(0);
  });
});

describe("handleLogin when admin auth is not configured", () => {
  it("answers a distinguishable code on 503 SERVICE_UNAVAILABLE", async () => {
    const { fetch } = recordingFetch(() =>
      json(503, errorEnvelope("SERVICE_UNAVAILABLE", "Not configured.", "r-3")),
    );
    const result = await handleLogin({
      body: { password: "pw" },
      baseUrl: BASE_URL,
      fetch,
      production: false,
    });
    expect(result.status).toBe(502);
    expect(result.cookie).toBeUndefined();
    expect(result.body).toEqual({
      success: false,
      message: "Admin sign-in is not configured on the server.",
      code: "ADMIN_AUTH_NOT_CONFIGURED",
      requestId: "r-3",
    });
  });

  it("keeps other 5xx failures on 502 with their own code", async () => {
    const { fetch } = recordingFetch(() =>
      json(500, errorEnvelope("INTERNAL_ERROR", "boom")),
    );
    const result = await handleLogin({
      body: { password: "pw" },
      baseUrl: BASE_URL,
      fetch,
      production: false,
    });
    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({ code: "INTERNAL_ERROR" });
  });
});

describe("loginErrorMessage", () => {
  it("shows the not-configured notice", () => {
    expect(
      loginErrorMessage(502, {
        code: "ADMIN_AUTH_NOT_CONFIGURED",
        message: "x",
      }),
    ).toBe("Admin sign-in is not configured on the server.");
  });

  it("shows Incorrect password. on 401", () => {
    expect(
      loginErrorMessage(401, { code: "UNAUTHORIZED", message: "nope" }),
    ).toBe("Incorrect password.");
  });

  it("keeps the server message for other failures", () => {
    expect(
      loginErrorMessage(429, {
        code: "RATE_LIMITED",
        message: "Too many attempts.",
      }),
    ).toBe("Too many attempts.");
    expect(loginErrorMessage(502, null)).toBe("Incorrect password.");
  });
});

describe("redis proxy upstream status handling", () => {
  const deps = (fetch: typeof globalThis.fetch) => ({
    baseUrl: BASE_URL,
    token: "tok",
    signal: new AbortController().signal,
    fetch,
  });

  it.each([
    ["keys", (f: typeof fetch) => proxyRedisKeys(deps(f), "*")],
    ["key", (f: typeof fetch) => proxyRedisKey(deps(f), "a:b")],
  ])("passes an upstream 4xx through for %s", async (_n, call) => {
    const { fetch } = recordingFetch(() =>
      json(400, {
        ...errorEnvelope("VALIDATION_ERROR", "Bad pattern.", "r-4"),
        errors: [{ path: "pattern", message: "Too long" }],
      }),
    );
    const response = await call(fetch);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      message: "Bad pattern.",
      code: "VALIDATION_ERROR",
      requestId: "r-4",
      errors: [{ path: "pattern", message: "Too long" }],
    });
  });

  it.each([
    ["keys", (f: typeof fetch) => proxyRedisKeys(deps(f), "*")],
    ["key", (f: typeof fetch) => proxyRedisKey(deps(f), "a")],
  ])(
    "keeps 401 as 401, 5xx and network failures as 502 for %s",
    async (_n, call) => {
      const unauthorized = recordingFetch(() =>
        json(401, errorEnvelope("UNAUTHORIZED", "Expired.")),
      );
      expect((await call(unauthorized.fetch)).status).toBe(401);

      const serverError = recordingFetch(() =>
        json(500, errorEnvelope("INTERNAL_ERROR", "boom")),
      );
      expect((await call(serverError.fetch)).status).toBe(502);

      const unavailable = recordingFetch(() =>
        json(503, errorEnvelope("SERVICE_UNAVAILABLE", "down")),
      );
      expect((await call(unavailable.fetch)).status).toBe(502);

      const network = (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch;
      expect((await call(network)).status).toBe(502);
    },
  );

  it("still forwards request.signal upstream", async () => {
    const controller = new AbortController();
    const { fetch, requests } = recordingFetch(() => json(200, okEnvelope([])));
    await proxyRedisKeys({ ...deps(fetch), signal: controller.signal }, "*");
    controller.abort();
    expect(requests[0]?.signal.aborted).toBe(true);
  });
});

describe("handleLogout", () => {
  it("clears the cookie for a same-origin request", () => {
    expect(
      handleLogout(new Headers({ "sec-fetch-site": "same-origin" })),
    ).toMatchObject({ status: 200, clearCookie: true });
  });

  it("answers 403 and keeps the cookie for a cross-site request", () => {
    expect(
      handleLogout(new Headers({ "sec-fetch-site": "cross-site" })),
    ).toMatchObject({ status: 403, clearCookie: false });
    expect(
      handleLogout(
        new Headers({ origin: "https://evil.example", host: "admin.test" }),
      ),
    ).toMatchObject({ status: 403, clearCookie: false });
  });
});

describe("system proxy handlers", () => {
  const health = {
    redis: { ok: true },
    database: { ok: true },
    rabbitmq: { ok: false },
  };

  it("sends the cookie token as a Bearer header and wraps the data", async () => {
    const { fetch, requests } = recordingFetch(() =>
      json(200, okEnvelope(health)),
    );
    const response = await proxySystemHealth({
      baseUrl: BASE_URL,
      token: "tok",
      signal: new AbortController().signal,
      fetch,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      message: "OK",
      data: health,
    });
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer tok");
    expect(requests[0]?.url).toBe("http://api.test/api/v1/admin/system/health");
  });

  it("propagates an upstream 401 as 401 JSON", async () => {
    const { fetch } = recordingFetch(() =>
      json(
        401,
        errorEnvelope("UNAUTHORIZED", "Admin session is missing or expired."),
      ),
    );
    const response = await proxySystemHealth({
      baseUrl: BASE_URL,
      token: "old",
      signal: new AbortController().signal,
      fetch,
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      success: false,
      code: "UNAUTHORIZED",
    });
  });

  it("maps another upstream failure to 502 with the API code", async () => {
    const { fetch } = recordingFetch(() =>
      json(500, errorEnvelope("INTERNAL_ERROR", "boom", "req-9")),
    );
    const response = await proxySystemHealth({
      baseUrl: BASE_URL,
      token: "tok",
      signal: new AbortController().signal,
      fetch,
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      success: false,
      code: "INTERNAL_ERROR",
      requestId: "req-9",
    });
  });

  it("maps a network failure to 502", async () => {
    const fetchFake = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const response = await proxySystemHealth({
      baseUrl: BASE_URL,
      token: "tok",
      signal: new AbortController().signal,
      fetch: fetchFake,
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: "NETWORK_ERROR" });
  });

  it("passes the abort signal upstream", async () => {
    const controller = new AbortController();
    const { fetch, requests } = recordingFetch(() =>
      json(200, okEnvelope(health)),
    );
    await proxySystemHealth({
      baseUrl: BASE_URL,
      token: "tok",
      signal: controller.signal,
      fetch,
    });
    const upstreamSignal = requests[0]?.signal;
    expect(upstreamSignal?.aborted).toBe(false);
    controller.abort();
    expect(upstreamSignal?.aborted).toBe(true);
  });

  it("encodes the redis key in the upstream path", async () => {
    const { fetch, requests } = recordingFetch(() =>
      json(200, okEnvelope({ type: "string", ttl: -1, value: "v" })),
    );
    await proxyRedisKey(
      {
        baseUrl: BASE_URL,
        token: "tok",
        signal: new AbortController().signal,
        fetch,
      },
      "rate:limit/1",
    );
    expect(requests[0]?.url).toBe(
      "http://api.test/api/v1/admin/system/redis/keys/rate%3Alimit%2F1",
    );
  });
});

describe("proxyLogStream", () => {
  it("streams the upstream body without buffering and passes the signal", async () => {
    const encoder = new TextEncoder();
    let release: (() => void) | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("data: first\n\n"));
        release = () => controller.close();
      },
    });
    const controller = new AbortController();
    const { fetch, requests } = recordingFetch(
      () =>
        new Response(body, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
    );

    const response = await proxyLogStream({
      baseUrl: BASE_URL,
      token: "tok",
      signal: controller.signal,
      fetch,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const reader = response.body?.getReader();
    const first = await reader?.read();
    expect(new TextDecoder().decode(first?.value)).toBe("data: first\n\n");
    expect(first?.done).toBe(false);

    expect(requests[0]?.headers.get("authorization")).toBe("Bearer tok");
    controller.abort();
    expect(requests[0]?.signal.aborted).toBe(true);
    release?.();
  });

  it("propagates an upstream 401 as 401 JSON", async () => {
    const { fetch } = recordingFetch(() =>
      json(
        401,
        errorEnvelope("UNAUTHORIZED", "Admin session is missing or expired."),
      ),
    );
    const response = await proxyLogStream({
      baseUrl: BASE_URL,
      token: undefined,
      signal: new AbortController().signal,
      fetch,
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("maps a 503 to 502 with the API code", async () => {
    const { fetch } = recordingFetch(() =>
      json(503, errorEnvelope("SERVICE_UNAVAILABLE", "Not configured.")),
    );
    const response = await proxyLogStream({
      baseUrl: BASE_URL,
      token: "tok",
      signal: new AbortController().signal,
      fetch,
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });
});
