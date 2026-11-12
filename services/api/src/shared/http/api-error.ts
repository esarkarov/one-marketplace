export interface ApiErrorDetail {
  path: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
    public readonly details?: readonly ApiErrorDetail[],
  ) {
    super(message);
    this.name = "ApiError";
  }
}
