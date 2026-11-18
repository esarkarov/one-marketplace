import { describe, expect, it } from "vitest";
import { expectNoClerkIds, findClerkIdLeaks } from "./clerk-id-scan.js";

describe("findClerkIdLeaks", () => {
  it("finds ids in nested values, arrays and substrings", () => {
    const body = {
      data: {
        results: [{ owner: { ref: "user_a" } }, { url: "/files/user_b/x.pdf" }],
      },
    };
    expect(findClerkIdLeaks(body, ["user_a", "user_b", "user_c"])).toEqual([
      "user_a",
      "user_b",
    ]);
  });

  it("ignores object keys", () => {
    expect(findClerkIdLeaks({ user_a: 1 }, ["user_a"])).toEqual([]);
  });

  it("throws when an id leaks and when nothing is scanned for", () => {
    expect(() => expectNoClerkIds({ a: "user_a" }, ["user_a"])).toThrow(
      "user_a",
    );
    expect(() => expectNoClerkIds({ a: 1 }, [])).toThrow();
    expect(() => expectNoClerkIds({ a: "x" }, ["user_a"])).not.toThrow();
  });
});
