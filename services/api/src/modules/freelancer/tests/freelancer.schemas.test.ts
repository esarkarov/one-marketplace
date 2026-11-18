import { describe, expect, it } from "vitest";

import {
  jobFeedQuerySchema,
  talentSearchQuerySchema,
  upsertProfileBodySchema,
} from "../schemas/freelancer.schema.js";

const body = (hourlyRateCents: unknown) => ({
  freelancerMetadata: { hourlyRateCents },
});

describe("upsertProfileBodySchema", () => {
  it.each([500, 100_000])("accepts hourlyRateCents %s", (value) => {
    expect(upsertProfileBodySchema.safeParse(body(value)).success).toBe(true);
  });

  it.each([
    ["fractional", 1000.5],
    ["negative", -500],
    ["below the minimum", 499],
    ["above the limit", 100_001],
    ["a string", "5000"],
    ["missing", undefined],
  ])("rejects %s hourlyRateCents", (_name, value) => {
    const result = upsertProfileBodySchema.safeParse(body(value));
    expect(result.success).toBe(false);
  });
});

describe("freelancer query schemas", () => {
  it.each(["1.5", "-1", "abc", "9007199254740993"])(
    "rejects cents filter %s",
    (value) => {
      expect(
        jobFeedQuerySchema.safeParse({ minBudgetCents: value }).success,
      ).toBe(false);
      expect(
        jobFeedQuerySchema.safeParse({ maxBudgetCents: value }).success,
      ).toBe(false);
      expect(
        talentSearchQuerySchema.safeParse({ minRateCents: value }).success,
      ).toBe(false);
      expect(
        talentSearchQuerySchema.safeParse({ maxRateCents: value }).success,
      ).toBe(false);
    },
  );

  it("parses integer cents filters", () => {
    expect(
      talentSearchQuerySchema.parse({ minRateCents: "500" }),
    ).toMatchObject({ minRateCents: 500 });
  });
});
