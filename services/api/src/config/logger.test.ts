import { context, trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  StackContextManager,
  TracerProvider,
} from "@opentelemetry/sdk-trace";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAppLogger,
  createRootLogger,
  registerLogEventListener,
} from "./logger.js";
import { captureLogs } from "@/test/support/capture-logs.js";
import {
  fakeStripeKey,
  fakeWebhookSecret,
} from "@/test/support/fake-secrets.js";
import { sanitizeForLog } from "@/shared/logging/sanitize-log.js";

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

describe("trace context mixin", () => {
  afterEach(() => {
    trace.disable();
    context.disable();
  });

  it("adds trace_id and span_id inside an active span and nothing outside", () => {
    const exporter = new InMemorySpanExporter();
    const provider = new TracerProvider({
      spanProcessors: [new SimpleSpanProcessor({ exporter })],
    });
    context.setGlobalContextManager(new StackContextManager().enable());
    trace.setGlobalTracerProvider(provider);
    const { stream, lines } = captureLogs();
    const appLogger = createAppLogger(createRootLogger(stream, "info"));

    void appLogger.info({ message: "outside" });
    const ids = trace.getTracer("test").startActiveSpan("work", (span) => {
      void appLogger.info({ message: "inside" });
      span.end();
      return span.spanContext();
    });
    void appLogger.info({ message: "after" });

    const [outside, inside, after] = lines().map((line) => JSON.parse(line));
    expect(outside).not.toHaveProperty("trace_id");
    expect(outside).not.toHaveProperty("span_id");
    expect(inside.trace_id).toBe(ids.traceId);
    expect(inside.span_id).toBe(ids.spanId);
    expect(after).not.toHaveProperty("trace_id");
    expect(exporter.getFinishedSpans()).toHaveLength(1);
  });

  it("adds nothing when no tracer provider is registered", () => {
    const { stream, lines } = captureLogs();
    const appLogger = createAppLogger(createRootLogger(stream, "info"));

    void appLogger.info({ message: "plain", eventName: "test.plain" });

    const entry = JSON.parse(lines()[0]!);
    expect(Object.keys(entry).sort()).toEqual(
      ["eventName", "hostname", "level", "msg", "pid", "time"].sort(),
    );
  });
});

describe("registerLogEventListener", () => {
  afterEach(() => registerLogEventListener(null));

  it("receives only the event name and level, never the message or attributes", async () => {
    const listener = vi.fn();
    registerLogEventListener(listener);
    const appLogger = createAppLogger(createRootLogger(undefined, "silent"));

    await appLogger.warning({
      message: "Bearer secret-token",
      eventName: "cache.redis.degraded",
      attributes: { "error.message": "boom" },
    });
    await appLogger.error({ message: "no event name" });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]![0]).toStrictEqual({
      eventName: "cache.redis.degraded",
      level: "warn",
    });
  });

  it("keeps logging when the listener throws", async () => {
    registerLogEventListener(() => {
      throw new Error("listener failed");
    });
    const { stream, lines } = captureLogs();
    const appLogger = createAppLogger(createRootLogger(stream, "info"));

    await expect(
      appLogger.info({ message: "still logged", eventName: "redis.error" }),
    ).resolves.toBeUndefined();
    expect(JSON.parse(lines()[0]!).msg).toBe("still logged");
  });
});
