import { describe, expect, it } from "vitest";

import { centsQueryParam, submitProposalBodySchema } from "./money-schemas.js";

const validProposal = {
  jobId: "123e4567-e89b-42d3-a456-426614174000",
  coverLetter: "x".repeat(80),
  bidAmountCents: 1000,
  duration: "2 weeks",
};

describe("submitProposalBodySchema", () => {
  it("accepts the bid limits and optional fields", () => {
    for (const bidAmountCents of [1, 100_000_000]) {
      const result = submitProposalBodySchema.parse({
        ...validProposal,
        bidAmountCents,
        role: "freelancer",
        screeningAnswers: [" a "],
      });
      expect(result.bidAmountCents).toBe(bidAmountCents);
      expect(result.screeningAnswers).toEqual(["a"]);
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
    const result = submitProposalBodySchema.safeParse({
      ...validProposal,
      bidAmountCents,
    });
    expect(result.success).toBe(false);
  });

  it.each([
    ["an unknown key", { extra: 1 }],
    ["a short cover letter", { coverLetter: "short" }],
    ["a long cover letter", { coverLetter: "x".repeat(10_001) }],
    ["a bad job id", { jobId: "nope" }],
    ["a long duration", { duration: "x".repeat(51) }],
    ["too many answers", { screeningAnswers: Array(11).fill("a") }],
    ["a non-string answer", { screeningAnswers: [1] }],
    ["a long answer", { screeningAnswers: ["x".repeat(5001)] }],
  ])("rejects %s", (_name, override) => {
    expect(
      submitProposalBodySchema.safeParse({ ...validProposal, ...override })
        .success,
    ).toBe(false);
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
