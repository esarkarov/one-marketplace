import { describe, expect, it } from "vitest";
import { CONTRACT_STATUS, parseOffset, TALENT_KIND_LABEL } from "./labels";

describe("labels", () => {
  it("gives CANCELLED its own label and tone", () => {
    expect(CONTRACT_STATUS.CANCELLED).toEqual({
      label: "Cancelled",
      tone: "red",
    });
    const tones = Object.values(CONTRACT_STATUS).map((entry) => entry.tone);
    expect(new Set(tones).size).toBe(tones.length);
  });

  it("labels the talent kinds the spec defines", () => {
    expect(TALENT_KIND_LABEL).toEqual({
      AGENCY: "Agency",
      FREELANCER: "Freelancer",
    });
  });

  it.each([
    [undefined, 0],
    ["", 0],
    ["abc", 0],
    ["-5", 0],
    ["20", 20],
    ["20.9", 20],
  ])("parseOffset(%s)", (input, expected) => {
    expect(parseOffset(input)).toBe(expected);
  });
});
