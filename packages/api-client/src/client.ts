import createClient, { type Middleware } from "openapi-fetch";
import { networkError } from "./errors";
import { operationsWithRole, operationsWithScope } from "./generated/meta";
import type { paths } from "./generated/schema";
import type { Role, Scope } from "./types";

export interface ApiClientOptions {
  /**
   * API origin, for example http://localhost:4000. A trailing /api/v1 is
   * accepted and removed because the spec paths already carry it.
   */
  baseUrl: string;
  /** Clerk (or admin session) token; null sends no Authorization header. Never logged or stored. */
  getToken: () => Promise<string | null>;
  getRole?: () => Role | undefined;
  getScope?: () => Scope | undefined;
  fetch?: typeof fetch;
}

const API_PREFIX = "/api/v1";
const SLASH = 47;

export const normalizeBaseUrl = (baseUrl: string): string => {
  let end = baseUrl.length;
  while (end > 0 && baseUrl.charCodeAt(end - 1) === SLASH) end -= 1;
  const trimmed = baseUrl.slice(0, end);
  return trimmed.endsWith(API_PREFIX)
    ? trimmed.slice(0, -API_PREFIX.length)
    : trimmed;
};

const isAbort = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { name?: unknown }).name === "AbortError";

const withQuery = async (
  request: Request,
  entries: Array<[string, string]>,
): Promise<Request> => {
  const url = new URL(request.url);
  let changed = false;

  for (const [name, value] of entries) {
    if (!url.searchParams.has(name)) {
      url.searchParams.set(name, value);
      changed = true;
    }
  }

  if (!changed) return request;

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const body = hasBody ? await request.arrayBuffer() : undefined;

  return new Request(url, {
    method: request.method,
    headers: request.headers,
    body: body && body.byteLength > 0 ? body : null,
    signal: request.signal,
    credentials: request.credentials,
    cache: request.cache,
    redirect: request.redirect,
    referrer: request.referrer,
    referrerPolicy: request.referrerPolicy,
    integrity: request.integrity,
    keepalive: request.keepalive,
    mode: request.mode,
  });
};

export const createApiClient = (options: ApiClientOptions) => {
  const client = createClient<paths>({
    baseUrl: normalizeBaseUrl(options.baseUrl),
    fetch: (request) => (options.fetch ?? globalThis.fetch)(request),
  });

  const middleware: Middleware = {
    async onRequest({ request, schemaPath }) {
      const key = `${request.method.toUpperCase()} ${schemaPath}`;
      const additions: Array<[string, string]> = [];

      if (operationsWithRole.has(key)) {
        const role = options.getRole?.();
        if (role) additions.push(["role", role]);
      }

      if (operationsWithScope.has(key)) {
        const scope = options.getScope?.();
        if (scope) additions.push(["scope", scope]);
      }

      const next = await withQuery(request, additions);
      const token = await options.getToken();

      if (token) next.headers.set("Authorization", `Bearer ${token}`);

      return next;
    },
    onError({ error }) {
      if (isAbort(error)) return;
      return networkError();
    },
  };

  client.use(middleware);

  return client;
};

export type ApiClient = ReturnType<typeof createApiClient>;
