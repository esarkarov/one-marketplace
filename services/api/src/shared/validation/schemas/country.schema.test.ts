import { describe, expect, it } from "vitest";
import { countryCodeSchema } from "./country.schema.js";

describe("countryCodeSchema", () => {
  it.each(["US", "DE", "JP", "XK"])("accepts %s", (code) => {
    expect(countryCodeSchema.parse(code)).toBe(code);
  });

  it.each([
    ["lowercase", "us"],
    ["mixed case", "Us"],
    ["three letters", "USA"],
    ["one letter", "U"],
    ["empty", ""],
    ["digits", "12"],
    ["padded", " US"],
    ["an unassigned region", "XX"],
    ["another unassigned region", "AA"],
    ["the unknown-region code", "ZZ"],
  ])("rejects %s", (_name, code) => {
    expect(countryCodeSchema.safeParse(code).success).toBe(false);
  });

  it.each([5, null, undefined, {}, ["US"]])("rejects the value %j", (value) => {
    expect(countryCodeSchema.safeParse(value).success).toBe(false);
  });

  it("reports why a value was rejected", () => {
    const format = countryCodeSchema.safeParse("usa");
    const region = countryCodeSchema.safeParse("XX");

    expect(format.error?.issues[0]?.message).toContain("alpha-2");
    expect(region.error?.issues[0]?.message).toContain("known region");
  });
});
