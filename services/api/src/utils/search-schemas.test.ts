import { describe, expect, it } from "vitest";

import { agencyTalentSearchQuerySchema } from "../modules/agency/agency.schemas.js";
import { marketplaceSearchQuerySchema } from "../modules/client/client.schemas.js";
import { talentSearchQuerySchema } from "../modules/freelancer/freelancer.schemas.js";
import {
  SEARCH_OFFSET_MAX,
  SEARCH_QUERY_MAX_LENGTH,
} from "./search-schemas.js";

const schemas = [
  ["talentSearchQuerySchema", talentSearchQuerySchema],
  ["agencyTalentSearchQuerySchema", agencyTalentSearchQuerySchema],
  ["marketplaceSearchQuerySchema", marketplaceSearchQuerySchema],
] as const;

describe.each(schemas)("%s paging and text caps", (_name, schema) => {
  it("parses a valid offset to a number and keeps short text", () => {
    expect(schema.parse({ offset: "40", query: "react" })).toMatchObject({
      offset: 40,
      query: "react",
    });
    expect(schema.parse({ offset: String(SEARCH_OFFSET_MAX) })).toMatchObject({
      offset: SEARCH_OFFSET_MAX,
    });
  });

  it("accepts a request without paging or text", () => {
    expect(schema.safeParse({}).success).toBe(true);
  });

  it.each(["-1", "1.5", "abc", String(SEARCH_OFFSET_MAX + 1)])(
    "rejects offset %s",
    (offset) => {
      expect(schema.safeParse({ offset }).success).toBe(false);
    },
  );

  it.each(["query", "q"])("caps %s at the maximum length", (key) => {
    expect(
      schema.safeParse({ [key]: "a".repeat(SEARCH_QUERY_MAX_LENGTH) }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ [key]: "a".repeat(SEARCH_QUERY_MAX_LENGTH + 1) })
        .success,
    ).toBe(false);
  });

  it("rejects repeated text parameters", () => {
    expect(schema.safeParse({ query: ["a", "b"] }).success).toBe(false);
  });
});
