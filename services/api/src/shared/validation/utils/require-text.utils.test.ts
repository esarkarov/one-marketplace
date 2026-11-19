import { describe, expect, it } from "vitest";
import { ApiError } from "@/shared/errors/api-error.js";
import { requireText, requireWebsite } from "./require-text.utils.js";

const failure = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
};

describe("requireText", () => {
  it("returns the trimmed string", () => {
    expect(requireText("  hello  ", "Name")).toBe("hello");
  });

  it.each([undefined, "", "   ", ["a"]])(
    "answers 400 '<field> is required.' for %j",
    (value) => {
      const error = failure(() => requireText(value, "Agency name"));

      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({
        statusCode: 400,
        message: "Agency name is required.",
      });
    },
  );
});

describe("requireWebsite", () => {
  it("returns an https URL unchanged apart from trimming", () => {
    expect(requireWebsite("  https://example.com/path  ")).toBe(
      "https://example.com/path",
    );
  });

  it("requires a value with the company website field name", () => {
    expect(failure(() => requireWebsite(undefined))).toMatchObject({
      statusCode: 400,
      message: "Company website is required.",
    });
  });

  it.each(["http://example.com", "ftp://example.com", "not a url"])(
    "rejects %s with the website message",
    (value) => {
      expect(failure(() => requireWebsite(value))).toMatchObject({
        statusCode: 400,
        message: "Company website must be a valid HTTP URL.",
      });
    },
  );
});
