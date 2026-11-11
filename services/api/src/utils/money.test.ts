import { describe, expect, it } from "vitest";
import {
  formatUsd,
  formatUsdGrouped,
  toSafeCents,
  legacyDollarsToCents,
  MAX_MONEY_CENTS,
  splitFee,
} from "./money.js";

describe("formatUsd", () => {
  it.each([
    [0, "$0.00"],
    [1, "$0.01"],
    [9, "$0.09"],
    [10, "$0.10"],
    [100, "$1.00"],
    [10025, "$100.25"],
    [123456789, "$1234567.89"],
    [MAX_MONEY_CENTS, "$90071992547409.91"],
  ])("formats %s cents as %s", (cents, text) => {
    expect(formatUsd(cents)).toBe(text);
  });

  it.each([-1, 1.5, Number.NaN, Infinity, MAX_MONEY_CENTS + 2])(
    "rejects %s",
    (cents) => {
      expect(() => formatUsd(cents)).toThrow(RangeError);
    },
  );
});

describe("splitFee", () => {
  it.each([
    [1, 0, 1],
    [4, 0, 4],
    [5, 1, 4],
    [35, 4, 31],
    [145, 15, 130],
    [10_000, 1_000, 9_000],
    [123_456, 12_346, 111_110],
  ])("splits %s cents into fee %s and net %s", (gross, fee, net) => {
    expect(splitFee(gross)).toEqual({ feeCents: fee, netCents: net });
  });

  it("rounds half up on exact ties", () => {
    expect(splitFee(25).feeCents).toBe(3);
    expect(splitFee(15).feeCents).toBe(2);
  });

  it("is exact near the safe integer limit", () => {
    const { feeCents, netCents } = splitFee(MAX_MONEY_CENTS);
    expect(feeCents + netCents).toBe(MAX_MONEY_CENTS);
    expect(feeCents).toBe(900_719_925_474_099);
  });

  it.each([0, -1, 1.5, Number.NaN, Infinity, MAX_MONEY_CENTS + 2])(
    "rejects gross %s",
    (gross) => {
      expect(() => splitFee(gross)).toThrow(RangeError);
    },
  );

  it("throws when the net would be below 1 cent", () => {
    expect(() => splitFee(1, 9_999)).toThrow(RangeError);
  });

  it.each([-1, 10_000, 1.5])("rejects fee bps %s", (bps) => {
    expect(() => splitFee(100, bps)).toThrow(RangeError);
  });
});

describe("legacyDollarsToCents", () => {
  it.each([
    [0, 0],
    [0.01, 1],
    [0.07, 7],
    [19.99, 1999],
    [0.29, 29],
    [1234.5, 123450],
    [1234.56, 123456],
    [9999999999.99, 999999999999],
  ])("converts %s to %s", (dollars, cents) => {
    expect(legacyDollarsToCents(dollars)).toBe(cents);
  });

  it.each([1.005, 0.001, -1, Number.NaN, Infinity, 1e21, 1e-7])(
    "rejects %s",
    (dollars) => {
      expect(() => legacyDollarsToCents(dollars)).toThrow(RangeError);
    },
  );
});

describe("formatUsdGrouped", () => {
  it.each([
    [0, "$0.00"],
    [5, "$0.05"],
    [123456, "$1,234.56"],
    [100000000, "$1,000,000.00"],
  ])("formats %s cents as %s", (cents, text) => {
    expect(formatUsdGrouped(cents)).toBe(text);
  });

  it.each([-1, 1.5, Number.NaN])("rejects %s", (cents) => {
    expect(() => formatUsdGrouped(cents)).toThrow(RangeError);
  });
});

describe("toSafeCents", () => {
  it.each([
    [null, 0],
    [undefined, 0],
    ["0", 0],
    ["123456", 123456],
    [42, 42],
    [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
  ])("converts %s to %s", (value, cents) => {
    expect(toSafeCents(value)).toBe(cents);
  });

  it.each(["9007199254740993", "1.5", "abc", "1e400"])(
    "throws for %s",
    (value) => {
      expect(() => toSafeCents(value)).toThrow(RangeError);
    },
  );
});
