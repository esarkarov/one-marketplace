import { describe, expect, it } from "vitest";
import { formatJson, isObject, sortKeys } from "./json.utils.js";

describe("isObject", () => {
  it("accepts plain objects only", () => {
    expect(isObject({})).toBe(true);
    expect(isObject([])).toBe(false);
    expect(isObject(null)).toBe(false);
    expect(isObject("a")).toBe(false);
  });
});

describe("sortKeys", () => {
  it("sorts keys at every depth and keeps array order", () => {
    const sorted = sortKeys({ b: 1, a: { d: [{ z: 1, y: 2 }, 3], c: null } });

    expect(JSON.stringify(sorted)).toBe(
      '{"a":{"c":null,"d":[{"y":2,"z":1},3]},"b":1}',
    );
  });
});

describe("formatJson", () => {
  it("sorts keys, inlines short scalar arrays and ends with a newline", () => {
    expect(formatJson({ b: [1, "x"], a: {}, c: [] })).toBe(
      '{\n  "a": {},\n  "b": [1, "x"],\n  "c": []\n}\n',
    );
  });

  it("wraps a scalar array that exceeds the print width", () => {
    const long = Array.from({ length: 12 }, (_, i) => `value-${i}`);
    const text = formatJson({ list: long });

    expect(text.startsWith('{\n  "list": [\n    "value-0",\n')).toBe(true);
    expect(JSON.parse(text)).toEqual({ list: long });
  });
});
