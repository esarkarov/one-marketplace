import { describe, expect, it } from "vitest";
import {
  escapeLikePattern,
  MAX_SEARCH_TERMS,
  toSearchTerms,
} from "./search-terms.js";

describe("toSearchTerms", () => {
  it("trims, lowercases and splits on whitespace runs", () => {
    expect(toSearchTerms("  React   DEVELOPER\tBerlin\n")).toEqual([
      "react",
      "developer",
      "berlin",
    ]);
  });

  it("returns no terms for empty, blank and missing queries", () => {
    expect(toSearchTerms("")).toEqual([]);
    expect(toSearchTerms("   \t ")).toEqual([]);
    expect(toSearchTerms(undefined)).toEqual([]);
    expect(toSearchTerms(null)).toEqual([]);
  });

  it("uses at most 10 terms and ignores the rest", () => {
    const query = Array.from({ length: 14 }, (_, index) => `t${index}`).join(
      " ",
    );
    const terms = toSearchTerms(query);
    expect(terms).toHaveLength(MAX_SEARCH_TERMS);
    expect(terms.at(-1)).toBe("t9");
  });

  it("does not fold diacritics", () => {
    expect(toSearchTerms("Zoë")).toEqual(["zoë"]);
  });
});

describe("escapeLikePattern", () => {
  it("escapes backslash, percent and underscore", () => {
    expect(escapeLikePattern("100%_a\\b")).toBe("100\\%\\_a\\\\b");
  });

  it("leaves other characters untouched", () => {
    expect(escapeLikePattern("node.js (v2) +c")).toBe("node.js (v2) +c");
  });
});
