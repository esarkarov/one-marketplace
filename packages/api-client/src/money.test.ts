import { describe, expect, it } from "vitest";
import { centsToDollarsString, dollarsToCents, formatCents } from "./index";

describe("dollarsToCents", () => {
  it.each([
    ["0", 0],
    ["12", 1200],
    ["12.5", 1250],
    ["12.50", 1250],
    ["0.05", 5],
    ["0.99", 99],
    ["19.99", 1999],
    ["1000000", 100000000],
    [12, 1200],
    [12.5, 1250],
    [0.07, 7],
    [1.1, 110],
    ["90071992547409.91", Number.MAX_SAFE_INTEGER],
  ])("parses %s", (input, expected) => {
    expect(dollarsToCents(input)).toBe(expected);
  });

  it.each([
    "12.345",
    "-1",
    "-0",
    "",
    " 5 ",
    " 5",
    "5 ",
    "1e3",
    "12.",
    ".5",
    "1,200.00",
    "1,200",
    "abc",
    "12.5.1",
    "+5",
    "0x10",
    "90071992547409.92",
    "99999999999999999999",
  ])("rejects %j", (input) => {
    expect(() => dollarsToCents(input)).toThrow(RangeError);
  });

  it.each([
    0.1 + 0.2,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1e21,
    5e-7,
    90071992547409.92,
  ])("rejects the number %s", (input) => {
    expect(() => dollarsToCents(input)).toThrow(RangeError);
  });

  it("does not use float rounding", () => {
    expect(dollarsToCents("1.15")).toBe(115);
    expect(dollarsToCents("8.2")).toBe(820);
    expect(dollarsToCents("4.35")).toBe(435);
  });

  it("rejects non-string, non-number input", () => {
    expect(() => dollarsToCents(undefined as never)).toThrow(RangeError);
    expect(() => dollarsToCents(null as never)).toThrow(RangeError);
  });
});

describe("centsToDollarsString", () => {
  it("formats with two decimals", () => {
    expect(centsToDollarsString(0)).toBe("0.00");
    expect(centsToDollarsString(5)).toBe("0.05");
    expect(centsToDollarsString(1250)).toBe("12.50");
    expect(centsToDollarsString(-1250)).toBe("-12.50");
    expect(centsToDollarsString(Number.MAX_SAFE_INTEGER)).toBe(
      "90071992547409.91",
    );
  });

  it("rejects fractions and unsafe values", () => {
    expect(() => centsToDollarsString(1.5)).toThrow(RangeError);
    expect(() => centsToDollarsString(Number.NaN)).toThrow(RangeError);
    expect(() => centsToDollarsString(2 ** 60)).toThrow(RangeError);
  });

  it("round-trips every cent from 0 to 10000", () => {
    for (let cents = 0; cents <= 10000; cents += 1) {
      expect(dollarsToCents(centsToDollarsString(cents))).toBe(cents);
    }
  });
});

describe("formatCents", () => {
  it("formats USD by default", () => {
    expect(formatCents(1250)).toBe("$12.50");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(123456789)).toBe("$1,234,567.89");
    expect(formatCents(-500)).toBe("-$5.00");
  });

  it("supports another currency and locale", () => {
    expect(formatCents(1250, "EUR", "de-DE")).toBe("12,50 €");
  });

  it("rejects fractions and non-finite input", () => {
    expect(() => formatCents(12.5)).toThrow(RangeError);
    expect(() => formatCents(Number.NaN)).toThrow(RangeError);
    expect(() => formatCents(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
