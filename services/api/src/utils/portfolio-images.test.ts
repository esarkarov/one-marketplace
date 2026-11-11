import { describe, expect, it } from "vitest";
import {
  liveUrlSchema,
  MAX_LIVE_URL_LENGTH,
  parseLiveUrl,
  reuseStoredImage,
} from "./portfolio-images.js";

describe("liveUrlSchema", () => {
  it.each([
    "javascript:alert(1)",
    "data:text/html;base64,AAAA",
    "ftp://example.com/file",
    "not a url",
    `https://example.com/${"a".repeat(MAX_LIVE_URL_LENGTH)}`,
  ])("rejects %s", (value) => {
    expect(liveUrlSchema.safeParse(value).success).toBe(false);
  });

  it("accepts http and https urls", () => {
    expect(liveUrlSchema.parse(" https://example.com/app ")).toBe(
      "https://example.com/app",
    );
    expect(liveUrlSchema.parse("http://example.com")).toBe(
      "http://example.com",
    );
  });

  it("treats empty and blank as absent", () => {
    expect(liveUrlSchema.parse("")).toBeUndefined();
    expect(liveUrlSchema.parse("   ")).toBeUndefined();
    expect(parseLiveUrl(undefined)).toBeUndefined();
  });

  it("throws a 400 ApiError from parseLiveUrl", () => {
    expect(() => parseLiveUrl("javascript:alert(1)")).toThrowError(
      expect.objectContaining({ statusCode: 400 }),
    );
  });
});

describe("reuseStoredImage", () => {
  const stored = { imageId: "id-1", url: "https://ik.example.test/a.png" };

  it("returns the stored id and url for a matching url", () => {
    expect(reuseStoredImage([null, stored], stored.url)).toEqual(stored);
  });

  it("throws 400 for an unknown url", () => {
    expect(() =>
      reuseStoredImage([stored], "https://other.example.test/b.png"),
    ).toThrowError(expect.objectContaining({ statusCode: 400 }));
  });
});
