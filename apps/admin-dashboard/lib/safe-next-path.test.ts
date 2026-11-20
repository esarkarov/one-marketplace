import { describe, expect, it } from "vitest";
import { expiredLoginPath, safeNextPath } from "./safe-next-path";

const cases: Array<[string, string | null | undefined, string]> = [
  ["plain root", "/", "/"],
  ["simple path", "/accounts", "/accounts"],
  ["path with query", "/ok?x=1", "/ok?x=1"],
  ["path with offset", "/contracts?offset=40", "/contracts?offset=40"],
  ["nested path", "/job-posts/abc", "/job-posts/abc"],
  ["path with hash", "/logs#top", "/logs#top"],
  ["protocol-relative", "//evil.example", "/"],
  ["protocol-relative with path", "//evil.example/path", "/"],
  ["slash backslash", "/\\evil", "/"],
  ["backslash inside", "/ok\\evil", "/"],
  ["absolute https", "https://evil.example", "/"],
  ["absolute http", "http://evil.example/x", "/"],
  ["javascript scheme", "javascript:alert(1)", "/"],
  ["data scheme", "data:text/html,x", "/"],
  ["no leading slash", "accounts", "/"],
  ["empty string", "", "/"],
  ["null", null, "/"],
  ["undefined", undefined, "/"],
  ["tab after slash", "/\t/evil", "/"],
  ["newline in path", "/ok\nSet-Cookie: a=b", "/"],
  ["carriage return", "/ok\rx", "/"],
  ["null byte", "/ok\u0000", "/"],
  ["delete character", "/ok\u007f", "/"],
  ["encoded double slash stays a local path", "/%2f%2fevil", "/%2f%2fevil"],
  ["encoded backslash stays a local path", "/%5Cevil", "/%5Cevil"],
  ["leading space", " /accounts", "/"],
  ["triple slash", "///evil.example", "/"],
  ["dot segments to protocol-relative", "/..//evil.example", "/"],
  ["userinfo-like segment", "/@evil.example", "/@evil.example"],
];

describe("safeNextPath", () => {
  it.each(cases)("%s", (_name, input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it("never returns a value that parses to another origin", () => {
    for (const [, input] of cases) {
      const result = safeNextPath(input);
      expect(new URL(result, "https://admin.invalid").origin).toBe(
        "https://admin.invalid",
      );
    }
  });
});

describe("expiredLoginPath", () => {
  it("encodes the current path", () => {
    expect(expiredLoginPath("/accounts?offset=20")).toBe(
      "/login?expired=1&next=%2Faccounts%3Foffset%3D20",
    );
  });

  it("falls back to the root for an unsafe path", () => {
    expect(expiredLoginPath("//evil.example")).toBe(
      "/login?expired=1&next=%2F",
    );
  });
});
