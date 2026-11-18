import { describe, expect, it } from "vitest";
import { PAGINATION } from "../constants/pagination.constants.js";
import {
  limitParam,
  offsetParam,
  paginationQuerySchema,
} from "./pagination.schema.js";

describe("paginationQuerySchema", () => {
  it("applies the defaults", () => {
    expect(paginationQuerySchema.parse({})).toEqual({ limit: 20, offset: 0 });
  });

  it("parses digit strings to integers at the bounds", () => {
    expect(
      paginationQuerySchema.parse({
        limit: String(PAGINATION.maxLimit),
        offset: String(PAGINATION.maxOffset),
      }),
    ).toEqual({ limit: PAGINATION.maxLimit, offset: PAGINATION.maxOffset });
    expect(paginationQuerySchema.parse({ limit: "1", offset: "0" })).toEqual({
      limit: 1,
      offset: 0,
    });
  });

  it.each(["0", "101", "-1", "1.5", "abc", "", "1e2", " 5"])(
    "rejects limit %j",
    (limit) => {
      expect(paginationQuerySchema.safeParse({ limit }).success).toBe(false);
    },
  );

  it.each(["10001", "-1", "1.5", "abc", ""])("rejects offset %j", (offset) => {
    expect(paginationQuerySchema.safeParse({ offset }).success).toBe(false);
  });

  it("rejects numbers, repeated values and unknown keys", () => {
    expect(paginationQuerySchema.safeParse({ limit: 5 }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ limit: ["1", "2"] }).success).toBe(
      false,
    );
    expect(paginationQuerySchema.safeParse({ extra: "1" }).success).toBe(false);
  });

  it("limitParam honours its own default and maximum", () => {
    const schema = limitParam({ defaultLimit: 30, max: 50 });

    expect(schema.parse(undefined)).toBe(30);
    expect(schema.parse("50")).toBe(50);
    expect(schema.safeParse("51").success).toBe(false);
    expect(offsetParam.parse(undefined)).toBe(0);
  });
});
