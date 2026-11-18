export interface ApiErrorDetail {
  path: string;
  message: string;
}

export const DEFAULT_ERROR_CODES = [
  "BAD_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "LOCKED",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
  "SERVICE_UNAVAILABLE",
] as const;

export type DefaultErrorCode = (typeof DEFAULT_ERROR_CODES)[number];

const DEFAULT_CODE_BY_STATUS: Readonly<Record<number, DefaultErrorCode>> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  415: "UNSUPPORTED_MEDIA_TYPE",
  423: "LOCKED",
  429: "RATE_LIMITED",
  500: "INTERNAL_ERROR",
  503: "SERVICE_UNAVAILABLE",
};

export const defaultErrorCode = (statusCode: number): string =>
  DEFAULT_CODE_BY_STATUS[statusCode] ??
  (statusCode >= 500 ? "INTERNAL_ERROR" : "BAD_REQUEST");

export class ApiError extends Error {
  public readonly code: string;

  constructor(
    public readonly statusCode: number,
    message: string,
    code?: string,
    public readonly details?: readonly ApiErrorDetail[],
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code ?? defaultErrorCode(statusCode);
  }
}
