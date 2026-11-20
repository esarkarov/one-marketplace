import { expiredLoginPath } from "./safe-next-path";

export class BrowserApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly requestId: string | undefined;

  constructor(
    message: string,
    status: number,
    code?: string,
    requestId?: string,
  ) {
    super(message);
    this.name = "BrowserApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

const FALLBACK_MESSAGE = "Could not reach the server.";

export async function getAdminJson<T>(
  url: string,
  options: {
    fetch?: typeof fetch;
    onUnauthenticated?: () => void;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  let response: Response;

  try {
    response = await fetchImpl(url, {
      cache: "no-store",
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new BrowserApiError(FALLBACK_MESSAGE, 0);
  }

  const body: unknown = await response.json().catch(() => null);
  const record =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};

  if (response.status === 401) {
    options.onUnauthenticated?.();
  }

  if (!response.ok) {
    throw new BrowserApiError(
      typeof record.message === "string" ? record.message : FALLBACK_MESSAGE,
      response.status,
      typeof record.code === "string" ? record.code : undefined,
      typeof record.requestId === "string" ? record.requestId : undefined,
    );
  }

  return record.data as T;
}

export function redirectToLogin() {
  window.location.href = expiredLoginPath(
    `${window.location.pathname}${window.location.search}`,
  );
}
