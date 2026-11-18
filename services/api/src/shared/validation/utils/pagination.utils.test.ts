import { describe, expect, it } from "vitest";
import { fetchSize, toOffsetPage } from "./pagination.utils.js";

describe("toOffsetPage", () => {
  it("asks for one extra row", () => {
    expect(fetchSize(20)).toBe(21);
  });

  it("reports no more rows at exactly the limit", () => {
    expect(toOffsetPage([1, 2, 3], 3)).toEqual({
      rows: [1, 2, 3],
      hasMore: false,
    });
  });

  it("trims the extra row and reports more at limit + 1", () => {
    expect(toOffsetPage([1, 2, 3, 4], 3)).toEqual({
      rows: [1, 2, 3],
      hasMore: true,
    });
  });
});
