import { describe, expect, it } from "vitest";

import { cents, isoDateTime } from "./scalar.responses.js";

describe("scalar response schemas", () => {
  it("cents accepts safe non-negative integers only", () => {
    expect(cents.safeParse(0).success).toBe(true);
    expect(cents.safeParse(Number.MAX_SAFE_INTEGER).success).toBe(true);
    expect(cents.safeParse(1.5).success).toBe(false);
    expect(cents.safeParse(-1).success).toBe(false);
    expect(cents.safeParse(Number.MAX_SAFE_INTEGER + 1).success).toBe(false);
  });

  it("isoDateTime rejects non-ISO strings", () => {
    expect(isoDateTime.safeParse("2026-01-02T03:04:05.000Z").success).toBe(
      true,
    );
    expect(isoDateTime.safeParse("02/01/2026").success).toBe(false);
    expect(isoDateTime.safeParse(1700000000).success).toBe(false);
  });
});
