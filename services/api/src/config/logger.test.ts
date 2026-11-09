import { describe, expect, it } from "vitest";
import { createAppLogger, createRootLogger } from "./logger.js";
import { captureLogs } from "../test/capture-logs.js";
import { fakeStripeKey, fakeWebhookSecret } from "../test/fake-secrets.js";
import { sanitizeForLog } from "../utils/sanitize-log.js";

describe("sanitizeForLog", () => {
  it("masks stripe keys, webhook secrets, bearer tokens and url credentials", () => {
    const text = [
      fakeStripeKey("test", "abc123DEF"),
      fakeStripeKey("live", "zzz999"),
      fakeWebhookSecret("abcDEF123"),
      "Bearer abc.def-ghi",
      "postgres://user:hunter2@db.local:5432/app",
    ].join(" ");
    const result = sanitizeForLog(text);

    for (const secret of [
      "abc123DEF",
      "zzz999",
      "abcDEF123",
      "abc.def-ghi",
      "hunter2",
    ]) {
      expect(result).not.toContain(secret);
    }
    expect(result).toContain("postgres://[Redacted]@db.local:5432/app");
  });

  it("truncates long text", () => {
    expect(sanitizeForLog("x".repeat(5000)).length).toBe(2000);
  });
});

describe("createAppLogger", () => {
  it("writes eventName and sanitized attributes and resolves", async () => {
    const { stream, lines } = captureLogs();
    const base = createRootLogger(stream, "info");
    const appLogger = createAppLogger(base);

    await expect(
      appLogger.warning({
        message: "something Bearer tok-123",
        eventName: "test.event",
        attributes: {
          "error.message": `bad ${fakeStripeKey("test", "secret1")}`,
          count: 2,
        },
      }),
    ).resolves.toBeUndefined();

    const entry = JSON.parse(lines()[0]!);
    expect(entry.eventName).toBe("test.event");
    expect(entry.attributes.count).toBe(2);
    expect(entry.attributes["error.message"]).not.toContain("secret1");
    expect(entry.msg).not.toContain("tok-123");
    expect(entry.level).toBe(40);
  });
});
