import { describe, expect, it } from "vitest";
import { buildSearchText, countryDisplayName } from "./search-text.js";

describe("buildSearchText", () => {
  it("lowercases and joins parts with one space", () => {
    expect(buildSearchText(["Ada Lovelace", "Senior ENGINEER"])).toBe(
      "ada lovelace senior engineer",
    );
  });

  it("collapses whitespace runs and trims each part", () => {
    expect(buildSearchText(["  Ada \t  Lovelace\n", "  x  "])).toBe(
      "ada lovelace x",
    );
  });

  it("drops null, undefined and empty parts", () => {
    expect(buildSearchText([null, undefined, "", "   ", "Berlin"])).toBe(
      "berlin",
    );
  });

  it("flattens arrays and drops empty entries", () => {
    expect(buildSearchText(["Dev", ["React", " ", "Node.js"], null])).toBe(
      "dev react node.js",
    );
  });

  it("returns an empty string when nothing remains", () => {
    expect(buildSearchText([null, [], ""])).toBe("");
  });

  it("does not fold diacritics", () => {
    expect(buildSearchText(["Zoë", "São Paulo"])).toBe("zoë são paulo");
  });
});

describe("countryDisplayName", () => {
  it("returns the English country name", () => {
    expect(countryDisplayName("DE")).toBe("Germany");
  });

  it("returns the input when the code is unknown or invalid", () => {
    expect(countryDisplayName("ZZ")).toBe("Unknown Region");
    expect(countryDisplayName("not a code")).toBe("not a code");
  });
});
