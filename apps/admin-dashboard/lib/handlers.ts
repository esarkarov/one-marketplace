import { errorMessage, isApiError, unwrap } from "@onemarketplace/api-client";
import { createAdminApi } from "./admin-api";
import { buildSessionCookie, isSameOriginRequest } from "./admin-session";
import type { SessionCookieOptions } from "./admin-session";

export interface UpstreamDeps {
  baseUrl: string;
  token: string | undefined;
  signal: AbortSignal;
  fetch?: typeof globalThis.fetch;
}

export interface FailureBody {
  success: false;
  message: string;
  code: string;
  requestId?: string;
  errors?: { path: string; message: string }[];
}

export const ADMIN_AUTH_NOT_CONFIGURED = "ADMIN_AUTH_NOT_CONFIGURED";
export const ADMIN_AUTH_NOT_CONFIGURED_MESSAGE =
  "Admin sign-in is not configured on the server.";

const isAbort = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  (error as { name?: unknown }).name === "AbortError";

export function failureFor(error: unknown): {
  status: number;
  body: FailureBody;
} {
  if (isAbort(error)) {
    return {
      status: 499,
      body: { success: false, message: "Request aborted.", code: "ABORTED" },
    };
  }

  if (isApiError(error)) {
    const body: FailureBody = {
      success: false,
      message: errorMessage(error),
      code: error.code,
    };
    if (error.requestId) body.requestId = error.requestId;
    return { status: error.status === 401 ? 401 : 502, body };
  }

  return {
    status: 502,
    body: {
      success: false,
      message: errorMessage(error),
      code: "UPSTREAM_ERROR",
    },
  };
}

const failureResponse = (error: unknown) => {
  const { status, body } = failureFor(error);
  return Response.json(body, { status });
};

export function passThroughFailureFor(error: unknown): {
  status: number;
  body: FailureBody;
} {
  if (isApiError(error) && error.status >= 400 && error.status < 500) {
    const body: FailureBody = {
      success: false,
      message: errorMessage(error),
      code: error.code,
    };
    if (error.requestId) body.requestId = error.requestId;
    if (error.errors) body.errors = error.errors;
    return { status: error.status, body };
  }
  return failureFor(error);
}

async function respondJson(
  call: () => Promise<unknown>,
  options: { passThrough4xx?: boolean } = {},
): Promise<Response> {
  try {
    const data = await call();
    return Response.json({ success: true, message: "OK", data });
  } catch (error) {
    if (options.passThrough4xx) {
      const { status, body } = passThroughFailureFor(error);
      return Response.json(body, { status });
    }
    return failureResponse(error);
  }
}

const apiFor = (deps: UpstreamDeps) =>
  createAdminApi({
    baseUrl: deps.baseUrl,
    token: deps.token,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  });

export function proxySystemHealth(deps: UpstreamDeps) {
  return respondJson(() =>
    unwrap(
      apiFor(deps).GET("/api/v1/admin/system/health", { signal: deps.signal }),
    ),
  );
}

export function proxyRedisKeys(deps: UpstreamDeps, pattern: string) {
  return respondJson(
    () =>
      unwrap(
        apiFor(deps).GET("/api/v1/admin/system/redis/keys", {
          params: { query: { pattern } },
          signal: deps.signal,
        }),
      ),
    { passThrough4xx: true },
  );
}

export function proxyRedisKey(deps: UpstreamDeps, key: string) {
  return respondJson(
    () =>
      unwrap(
        apiFor(deps).GET("/api/v1/admin/system/redis/keys/{key}", {
          params: { path: { key } },
          signal: deps.signal,
        }),
      ),
    { passThrough4xx: true },
  );
}

export async function proxyLogStream(deps: UpstreamDeps): Promise<Response> {
  try {
    const result = await apiFor(deps).GET("/api/v1/admin/logs/stream", {
      parseAs: "stream",
      signal: deps.signal,
    });

    if (result.error !== undefined) {
      await unwrap(Promise.resolve(result));
    }

    if (!result.data) {
      return Response.json(
        {
          success: false,
          message: "Log stream unavailable.",
          code: "UPSTREAM_ERROR",
        } satisfies FailureBody,
        { status: 502 },
      );
    }

    return new Response(result.data, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return failureResponse(error);
  }
}

export interface LoginResult {
  status: number;
  body: { success: true } | FailureBody;
  cookie?: { name: string; value: string; options: SessionCookieOptions };
}

export async function handleLogin({
  body,
  baseUrl,
  fetch: fetchImpl,
  production,
  now,
}: {
  body: unknown;
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
  production: boolean;
  now?: number;
}): Promise<LoginResult> {
  const password =
    typeof body === "object" && body !== null
      ? (body as { password?: unknown }).password
      : undefined;

  if (typeof password !== "string" || password.length === 0) {
    return {
      status: 400,
      body: {
        success: false,
        message: "Password is required.",
        code: "VALIDATION_ERROR",
      },
    };
  }

  const api = createAdminApi({
    baseUrl,
    token: undefined,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });

  let session: { token: string; expiresAt: string };
  try {
    session = await unwrap(
      api.POST("/api/v1/admin/auth/login", { body: { password } }),
    );
  } catch (error) {
    if (
      isApiError(error) &&
      error.status === 503 &&
      error.code === "SERVICE_UNAVAILABLE"
    ) {
      const failure: FailureBody = {
        success: false,
        message: ADMIN_AUTH_NOT_CONFIGURED_MESSAGE,
        code: ADMIN_AUTH_NOT_CONFIGURED,
      };
      if (error.requestId) failure.requestId = error.requestId;
      return { status: 502, body: failure };
    }
    if (isApiError(error) && error.status >= 400 && error.status < 500) {
      const failure: FailureBody = {
        success: false,
        message: errorMessage(error),
        code: error.code,
      };
      if (error.requestId) failure.requestId = error.requestId;
      return { status: error.status, body: failure };
    }
    const { body: failure } = failureFor(error);
    return { status: 502, body: failure };
  }

  const cookie = buildSessionCookie({
    token: session.token,
    expiresAt: session.expiresAt,
    ...(now === undefined ? {} : { now }),
    production,
  });

  if (!cookie.ok) {
    return {
      status: 502,
      body: {
        success: false,
        message: "The server returned an invalid session.",
        code: "INVALID_SESSION",
      },
    };
  }

  return {
    status: 200,
    body: { success: true },
    cookie: { name: cookie.name, value: cookie.value, options: cookie.options },
  };
}

export function handleLogout(headers: Headers): {
  status: number;
  body: { success: true } | FailureBody;
  clearCookie: boolean;
} {
  if (!isSameOriginRequest(headers)) {
    return {
      status: 403,
      body: {
        success: false,
        message: "Cross-site requests are not allowed.",
        code: "FORBIDDEN",
      },
      clearCookie: false,
    };
  }
  return { status: 200, body: { success: true }, clearCookie: true };
}
