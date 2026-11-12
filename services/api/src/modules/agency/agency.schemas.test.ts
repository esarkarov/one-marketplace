import { describe, expect, it } from "vitest";

import {
  agencyJobFeedQuerySchema,
  agencyTalentSearchQuerySchema,
  createAgencyBodySchema,
  updateAgencyBodySchema,
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

describe("agency body nulls", () => {
  it("accepts null for website, professionalTitle, avatarImage, tags and portfolio", () => {
    const parsed = updateAgencyBodySchema.safeParse({
      name: "A",
      professionalTitle: null,
      website: null,
      avatarImage: null,
      tags: null,
      portfolio: null,
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts a null website and null image url on create and nested images", () => {
    expect(createAgencyBodySchema.safeParse({ website: null }).success).toBe(
      true,
    );
    expect(
      updateAgencyBodySchema.safeParse({ avatarImage: { url: null } }).success,
    ).toBe(true);
  });

  it("strips id, imageId, createdAt and updatedAt on create", () => {
    const parsed = createAgencyBodySchema.parse({
      name: "Acme",
      id: "x",
      imageId: "x",
      createdAt: "x",
      updatedAt: "x",
    });

    expect(parsed).toEqual({ name: "Acme" });
  });

  it("rejects other unknown keys on create", () => {
    expect(
      createAgencyBodySchema.safeParse({ name: "Acme", extra: 1 }).success,
    ).toBe(false);
  });
});
