import { describe, expect, it } from "vitest";

import { centsQueryParam, submitProposalBodySchema } from "./money-schemas.js";

describe("submitProposalBodySchema", () => {
  it("accepts the bid limits and keeps other fields", () => {
    for (const bidAmountCents of [1, 100_000_000]) {
      const result = submitProposalBodySchema.parse({
        bidAmountCents,
        coverLetter: "x",
      });
      expect(result.bidAmountCents).toBe(bidAmountCents);
      expect(result.coverLetter).toBe("x");
    }
  });

  it.each([
    ["fractional", 10.5],
    ["negative", -100],
    ["zero", 0],
    ["above the limit", 100_000_001],
    ["a string", "1000"],
    ["missing", undefined],
  ])("rejects %s bidAmountCents", (_name, bidAmountCents) => {
    const result = submitProposalBodySchema.safeParse({ bidAmountCents });
    expect(result.success).toBe(false);
  });
});

describe("centsQueryParam", () => {
  it("parses integer cents and allows absence", () => {
    expect(centsQueryParam.parse("500")).toBe(500);
    expect(centsQueryParam.parse(undefined)).toBeUndefined();
  });

  it.each(["1.5", "-1", "abc", "", "9007199254740993"])(
    "rejects %s",
    (value) => {
      expect(centsQueryParam.safeParse(value).success).toBe(false);
    },
  );
});
