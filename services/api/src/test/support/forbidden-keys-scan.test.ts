import { describe, expect, it } from "vitest";
import {
  expectNoStoredNormalization,
  findForbiddenKeys,
} from "./forbidden-keys-scan.js";

describe("findForbiddenKeys", () => {
  it("finds a key at any depth, in arrays and in nested objects", () => {
    const body = {
      data: { results: [{ id: 1, nested: { content_norm: "x" } }] },
    };
    expect(findForbiddenKeys(body, ["content_norm", "contentNorm"])).toEqual([
      "content_norm",
    ]);
  });

  it("ignores the same text used as a value", () => {
    expect(findForbiddenKeys({ a: "content_norm" }, ["content_norm"])).toEqual(
      [],
    );
  });

  it("throws for both spellings of the stored column", () => {
    expect(() =>
      expectNoStoredNormalization({ a: [{ contentNorm: "" }] }),
    ).toThrow();
    expect(() => expectNoStoredNormalization({ content_norm: "" })).toThrow();
    expect(() => expectNoStoredNormalization({ title: "x" })).not.toThrow();
  });
});
