import { describe, expect, it } from "vitest";
import { isLargeBodyRoute } from "./json-body.middleware.js";

describe("isLargeBodyRoute", () => {
  it.each([
    ["POST", "/api/v1/jobs"],
    ["PUT", "/api/v1/jobs/abc"],
    ["POST", "/api/v1/conversations/abc/messages"],
    ["PUT", "/api/v1/freelancer/profile"],
    ["PUT", "/api/v1/agency"],
  ])("allows large bodies for %s %s", (method, path) => {
    expect(isLargeBodyRoute(method, path)).toBe(true);
  });

  it.each([
    ["GET", "/api/v1/jobs/saved/abc"],
    ["POST", "/api/v1/agency"],
    ["POST", "/api/v1/proposals"],
  ])("keeps the default limit for %s %s", (method, path) => {
    expect(isLargeBodyRoute(method, path)).toBe(false);
  });
});
