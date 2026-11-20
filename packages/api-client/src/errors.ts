export interface ApiFieldError {
  path: string;
  message: string;
}

export interface ApiErrorInit {
  status: number;
  code: string;
  message: string;
  requestId?: string | undefined;
  errors?: ApiFieldError[] | undefined;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;
  readonly errors: ApiFieldError[] | undefined;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.requestId = init.requestId;
    this.errors = init.errors;
  }
}

export const isApiError = (value: unknown): value is ApiError =>
  value instanceof ApiError;

export const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";
export const NETWORK_ERROR_MESSAGE =
  "Could not reach the server. Check your connection and try again.";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toFieldErrors = (value: unknown): ApiFieldError[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter(
    (item): item is ApiFieldError =>
      isRecord(item) &&
      typeof item.path === "string" &&
      typeof item.message === "string",
  );
  return items.length > 0
    ? items.map(({ path, message }) => ({ path, message }))
    : undefined;
};

export const networkError = (): ApiError =>
  new ApiError({
    status: 0,
    code: "NETWORK_ERROR",
    message: NETWORK_ERROR_MESSAGE,
  });

/**
 * Builds an ApiError from a non-2xx response. `body` is whatever the HTTP
 * layer parsed: the API's error envelope, a string (HTML page) or empty.
 */
export const apiErrorFromResponse = (
  status: number,
  body: unknown,
): ApiError => {
  if (
    isRecord(body) &&
    body.success === false &&
    typeof body.code === "string" &&
    body.code.length > 0 &&
    typeof body.message === "string"
  ) {
    return new ApiError({
      status,
      code: body.code,
      message: body.message,
      requestId:
        typeof body.requestId === "string" ? body.requestId : undefined,
      errors: toFieldErrors(body.errors),
    });
  }

  return new ApiError({
    status,
    code: "HTTP_ERROR",
    message: `Request failed with status ${status}.`,
  });
};

/** A string safe to show to a user: never a stack, raw body or 5xx detail. */
export const errorMessage = (error: unknown): string => {
  if (!isApiError(error)) return GENERIC_ERROR_MESSAGE;
  if (error.status === 0) return NETWORK_ERROR_MESSAGE;
  if (
    error.status >= 400 &&
    error.status < 500 &&
    error.code !== "HTTP_ERROR"
  ) {
    return error.message;
  }
  return GENERIC_ERROR_MESSAGE;
};
