import { describe, expect, it } from "vitest";
import { isValidPayoutAmount, toMinorUnits } from "./money.js";

describe("toMinorUnits", () => {
  it.each([
    [0, 0],
    [0.01, 1],
    [1.005, 100],
    [19.99, 1999],
    [0.29, 29],
    [1234.56, 123456],
  ])("converts %s to %s", (amount, expected) => {
    expect(toMinorUnits(amount)).toBe(expected);
  });
});

describe("isValidPayoutAmount", () => {
  it.each([0.01, 1, 450.5])("accepts %s", (amount) => {
    expect(isValidPayoutAmount(amount)).toBe(true);
  });

  it.each([0, -1, 0.004, Number.NaN, Infinity, -Infinity])(
    "rejects %s",
    (amount) => {
      expect(isValidPayoutAmount(amount)).toBe(false);
    },
  );
});
