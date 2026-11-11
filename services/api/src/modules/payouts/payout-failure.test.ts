import { describe, expect, it } from "vitest";
import { fakeStripeKey } from "../../test/fake-secrets.js";
import {
  bumpIdempotencyKey,
  classifyPayoutFailure,
  retryDelaySeconds,
} from "./payout-failure.js";

const stripeError = (type: string, statusCode?: number, code?: string) =>
  Object.assign(
    new Error(`raw message with ${fakeStripeKey("live", "abcdefghij1234")}`),
    {
      type,
      statusCode,
      code,
    },
  );

describe("classifyPayoutFailure", () => {
  it.each([
    [
      "connection error",
      stripeError("StripeConnectionError"),
      "StripeConnectionError",
    ],
    [
      "connection error with a 200 status (incomplete response body)",
      stripeError("StripeConnectionError", 200),
      "StripeConnectionError",
    ],
    [
      "connection error with a 400 status",
      stripeError("StripeConnectionError", 400),
      "StripeConnectionError",
    ],
    ["api error 500", stripeError("StripeAPIError", 500), "StripeAPIError"],
    [
      "rate limit",
      stripeError("StripeRateLimitError", 429, "rate_limit"),
      "rate_limit",
    ],
    [
      "key in use",
      stripeError("StripeIdempotencyError", 400, "idempotency_key_in_use"),
      "idempotency_key_in_use",
    ],
    [
      "idempotency parameter mismatch with status 400",
      stripeError("StripeIdempotencyError", 400, "idempotency_error"),
      "idempotency_error",
    ],
    [
      "idempotency error without a code",
      stripeError("StripeIdempotencyError", 400),
      "StripeIdempotencyError",
    ],
    [
      "409",
      stripeError("StripeInvalidRequestError", 409),
      "StripeInvalidRequestError",
    ],
    ["non stripe error", new TypeError("boom"), "TypeError"],
    ["non object", "oops", "unknown_error"],
  ])("treats %s as unknown outcome", (_name, error, code) => {
    expect(classifyPayoutFailure(error)).toEqual({ kind: "unknown", code });
  });

  it.each([
    [
      stripeError("StripeInvalidRequestError", 400, "balance_insufficient"),
      "StripeInvalidRequestError:balance_insufficient",
    ],
    [stripeError("StripePermissionError", 403), "StripePermissionError"],
    [
      stripeError("StripeAuthenticationError", 401),
      "StripeAuthenticationError",
    ],
  ])("treats 4xx as definitive", (error, code) => {
    expect(classifyPayoutFailure(error)).toEqual({ kind: "definitive", code });
  });

  it("never exposes the raw message", () => {
    const result = classifyPayoutFailure(
      stripeError("StripeInvalidRequestError", 400, "x"),
    );
    expect(JSON.stringify(result)).not.toContain("sk_live");
  });
});

describe("retryDelaySeconds", () => {
  it.each([
    [1, 300],
    [2, 1800],
    [3, 7200],
    [4, 43200],
  ])("attempt %s waits %s seconds", (attempts, seconds) => {
    expect(retryDelaySeconds(attempts)).toBe(seconds);
  });

  it("stops retrying from the fifth attempt", () => {
    expect(retryDelaySeconds(5)).toBeNull();
    expect(retryDelaySeconds(9)).toBeNull();
  });
});

describe("bumpIdempotencyKey", () => {
  it("increments the counter", () => {
    expect(bumpIdempotencyKey("p1", "payout:p1:1")).toBe("payout:p1:2");
    expect(bumpIdempotencyKey("p1", "payout:p1:4")).toBe("payout:p1:5");
  });

  it("falls back to 2 for a missing key", () => {
    expect(bumpIdempotencyKey("p1", null)).toBe("payout:p1:2");
  });
});
