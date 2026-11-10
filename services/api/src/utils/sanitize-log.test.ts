import { describe, expect, it } from "vitest";
import {
  errorCodeForLog,
  errorLogAttributes,
  errorMessageForLog,
  sanitizeForLog,
} from "./sanitize-log.js";

const fakeJwt = () =>
  ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiJ1c2VyXzEyMyJ9", "c2lnbmF0dXJlMTIz"].join(
    ".",
  );
const fakeImageKitKey = () => ["private", "AbCdEf+12/34=gh"].join("_");
const fakeHexToken = () => "a1b2c3d4e5".repeat(4);

const drizzleStyleError = () =>
  new Error(
    [
      "Failed query: select * from accounts where email = $1",
      "params: alice@example.test,42",
    ].join("\n"),
    { cause: Object.assign(new Error("duplicate"), { code: "23505" }) },
  );

describe("sanitizeForLog extra rules", () => {
  it("redacts a bare JWT, an ImageKit-style key and a long hex token", () => {
    const result = sanitizeForLog(
      `jwt ${fakeJwt()} key ${fakeImageKitKey()} hash ${fakeHexToken()} end`,
    );

    expect(result).not.toContain("eyJhbGci");
    expect(result).not.toContain("AbCdEf");
    expect(result).not.toContain(fakeHexToken());
    expect(result).toBe("jwt [Redacted] key [Redacted] hash [Redacted] end");
  });

  it("leaves ordinary text and UUIDs alone", () => {
    const text = "user 3f2b8c1e-9a4d-4e7f-8b21-5c6d7e8f9a0b updated profile";

    expect(sanitizeForLog(text)).toBe(text);
  });
});

describe("errorMessageForLog", () => {
  it("hides database query text and params", () => {
    const result = errorMessageForLog(drizzleStyleError());

    expect(result).toBe("Database query failed");
    expect(result).not.toContain("select");
    expect(result).not.toContain("alice@example.test");
  });

  it("keeps only the first line", () => {
    expect(errorMessageForLog(new Error("first line\nsecond line"))).toBe(
      "first line",
    );
  });

  it("sanitizes and truncates the first line", () => {
    const result = errorMessageForLog(
      new Error(`token ${fakeJwt()} ${"x".repeat(500)}`),
    );

    expect(result).not.toContain("eyJhbGci");
    expect(result.length).toBeLessThanOrEqual(300);
  });

  it("handles non-error values", () => {
    expect(errorMessageForLog("plain failure")).toBe("plain failure");
  });
});

describe("errorCodeForLog", () => {
  it("reads code from the error", () => {
    expect(
      errorCodeForLog(Object.assign(new Error("x"), { code: "ECONN" })),
    ).toBe("ECONN");
  });

  it("reads code from the cause", () => {
    expect(errorCodeForLog(drizzleStyleError())).toBe("23505");
  });

  it("returns undefined when there is no string code", () => {
    expect(errorCodeForLog(new Error("x"))).toBeUndefined();
    expect(errorCodeForLog(Object.assign(new Error("x"), { code: 5 }))).toBe(
      undefined,
    );
    expect(errorCodeForLog(null)).toBeUndefined();
  });
});

describe("errorLogAttributes", () => {
  it("includes the code only when present", () => {
    expect(errorLogAttributes(drizzleStyleError())).toEqual({
      "error.message": "Database query failed",
      "error.code": "23505",
    });
    expect(errorLogAttributes(new Error("boom"))).toEqual({
      "error.message": "boom",
    });
  });
});

describe("broker url masking", () => {
  it("masks credentials in amqp and amqps urls", () => {
    const result = sanitizeForLog(
      "connect amqp://guest:hunter2@broker:5672/vhost and amqps://u:p4ss@b.example.test",
    );

    expect(result).not.toContain("hunter2");
    expect(result).not.toContain("p4ss");
    expect(result).toBe(
      "connect amqp://[Redacted]@broker:5672/vhost and amqps://[Redacted]@b.example.test",
    );
  });

  it("masks broker credentials inside error messages", () => {
    const error = new Error("ECONNREFUSED amqp://user:secretpw@host:5672");

    const attributes = errorLogAttributes(error);

    expect(attributes["error.message"]).not.toContain("secretpw");
    expect(attributes["error.message"]).toContain("amqp://[Redacted]@host");
  });

  it("masks broker credentials in stacks", () => {
    const error = new Error("boom amqps://admin:topsecret@broker");

    expect(sanitizeForLog(error.stack ?? "")).not.toContain("topsecret");
  });
});
