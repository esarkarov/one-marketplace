import { describe, expect, it } from "vitest";

import {
  agencyJobFeedQuerySchema,
  agencyTalentSearchQuerySchema,
} from "./agency.schemas.js";

describe("agencyJobFeedQuerySchema and agencyTalentSearchQuerySchema", () => {
  it.each(["1.5", "-1", "abc", "9007199254740993"])(
    "rejects cents filter %s",
    (value) => {
      expect(
        agencyJobFeedQuerySchema.safeParse({ minBudgetCents: value }).success,
      ).toBe(false);
      expect(
        agencyJobFeedQuerySchema.safeParse({ maxBudgetCents: value }).success,
      ).toBe(false);
      expect(
        agencyTalentSearchQuerySchema.safeParse({ maxRateCents: value })
          .success,
      ).toBe(false);
    },
  );

  it("parses integer cents filters", () => {
    expect(
      agencyJobFeedQuerySchema.parse({ minBudgetCents: "500" }).minBudgetCents,
    ).toBe(500);
  });
});
