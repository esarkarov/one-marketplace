import { describe, expect, it } from "vitest";

import { agencyTalentSearchQuerySchema } from "@/modules/agency/schemas/agency.schema.js";
import { marketplaceSearchQuerySchema } from "@/modules/client/schemas/client.schema.js";
import { talentSearchQuerySchema } from "@/modules/freelancer/schemas/freelancer.schema.js";
import {
  SEARCH_OFFSET_MAX,
  SEARCH_QUERY_MAX_LENGTH,
} from "@/shared/validation/constants/search.constants.js";

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

  it("caps query at the maximum length", () => {
    expect(
      schema.safeParse({ query: "a".repeat(SEARCH_QUERY_MAX_LENGTH) }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ query: "a".repeat(SEARCH_QUERY_MAX_LENGTH + 1) })
        .success,
    ).toBe(false);
  });

  it("rejects the removed q alias like any other unknown key", () => {
    const withQ = schema.safeParse({ q: "react" });
    const withExtra = schema.safeParse({ extra: "react" });

    expect(withQ.success).toBe(false);
    expect(withQ.error?.issues[0]?.code).toBe("unrecognized_keys");
    expect(withQ.error?.issues[0]?.code).toBe(withExtra.error?.issues[0]?.code);
  });

  it("rejects repeated text parameters", () => {
    expect(schema.safeParse({ query: ["a", "b"] }).success).toBe(false);
  });
});
