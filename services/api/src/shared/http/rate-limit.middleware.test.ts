import { describe, expect, it } from "vitest";
import { isRateLimitExempt } from "./rate-limit.middleware.js";

describe("isRateLimitExempt", () => {
  it.each([
    ["POST", "/connects/webhook"],
    ["POST", "/contracts/webhook"],
    ["POST", "/identity/webhook"],
    ["POST", "/meetings/webhook"],
    ["GET", "/health"],
    ["GET", "/ready"],
  ])("exempts %s %s", (method, path) => {
    expect(isRateLimitExempt(method, path)).toBe(true);
  });

  it.each([
    ["GET", "/jobs/webhook"],
    ["POST", "/jobs/webhook"],
    ["GET", "/connects/webhook"],
    ["POST", "/health"],
    ["POST", "/ready"],
    ["GET", "/jobs"],
  ])("does not exempt %s %s", (method, path) => {
    expect(isRateLimitExempt(method, path)).toBe(false);
  });
});
