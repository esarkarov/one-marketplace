import { describe, expect, it } from "vitest";

import { centsQueryParam } from "./money.schema.js";

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
