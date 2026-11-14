export const PAYOUT_MAX_ATTEMPTS = 5;

export const RETRY_BACKOFF_SECONDS = [
  5 * 60,
  30 * 60,
  2 * 60 * 60,
  12 * 60 * 60,
  24 * 60 * 60,
] as const;

export type PayoutFailure = {
  kind: "unknown" | "definitive";
  code: string;
};

const safeToken = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const token = value.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 64);
  return token || undefined;
};

export const classifyPayoutFailure = (error: unknown): PayoutFailure => {
  const source =
    typeof error === "object" && error !== null
      ? (error as {
          type?: unknown;
          code?: unknown;
          statusCode?: unknown;
          name?: unknown;
        })
      : {};
  const type = safeToken(source.type);
  const code = safeToken(source.code);
  const status =
    typeof source.statusCode === "number" ? source.statusCode : undefined;

  const unknownOutcome =
    type === undefined ||
    status === undefined ||
    code === "idempotency_key_in_use" ||
    type === "StripeIdempotencyError" ||
    type === "StripeConnectionError" ||
    type === "StripeAPIError" ||
    type === "StripeRateLimitError" ||
    status === 409 ||
    status === 429 ||
    status >= 500;

  if (unknownOutcome) {
    return {
      kind: "unknown",
      code: code ?? type ?? safeToken(source.name) ?? "unknown_error",
    };
  }
  return {
    kind: "definitive",
    code: code ? `${type}:${code}` : type,
  };
};

export const retryDelaySeconds = (attempts: number): number | null => {
  if (attempts >= PAYOUT_MAX_ATTEMPTS) return null;
  const index = Math.max(0, attempts - 1);
  return RETRY_BACKOFF_SECONDS[index] ?? null;
};

export const initialIdempotencyKey = (payoutId: string): string =>
  `payout:${payoutId}:1`;

export const bumpIdempotencyKey = (
  payoutId: string,
  currentKey: string | null,
): string => {
  const current = Number(currentKey?.split(":").at(-1));
  const next = Number.isInteger(current) && current >= 1 ? current + 1 : 2;
  return `payout:${payoutId}:${next}`;
};
