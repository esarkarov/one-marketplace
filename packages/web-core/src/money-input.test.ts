import { describe, expect, it } from "vitest";
import { centsToFormAmount, toCents, validateMoneyInput } from "./money-input";

const bounds = { minCents: 501, maxCents: 100_000_000 };

describe("money input", () => {
  it("converts dollars to cents without float math", () => {
    expect(toCents(19.99)).toBe(1999);
    expect(toCents("12.5")).toBe(1250);
    expect(toCents(0.1 + 0.2)).toBeNull();
    expect(toCents(Number.NaN)).toBeNull();
    expect(toCents(-5)).toBeNull();
  });

  it("validates against the given bounds", () => {
    expect(validateMoneyInput(5.01, bounds)).toBeNull();
    expect(validateMoneyInput(10, bounds)).toBeNull();
    expect(validateMoneyInput(5, bounds)).toBe(
      "Budget must be at least $5.01.",
    );
    expect(validateMoneyInput(0, bounds)).toBe(
      "Budget must be at least $5.01.",
    );
    expect(validateMoneyInput(Number.NaN, bounds)).toBe(
      "Enter a valid number.",
    );
    expect(validateMoneyInput(10.123, bounds)).toBe(
      "Use a plain amount with at most 2 decimals.",
    );
    expect(validateMoneyInput(1_000_000.01, bounds)).toBe(
      "Budget cannot exceed $1,000,000.00.",
    );
  });

  it("round trips cents through the form amount", () => {
    for (const cents of [1000, 1999, 1250, 100_000_000, 1001]) {
      expect(toCents(centsToFormAmount(cents))).toBe(cents);
    }
  });
});
