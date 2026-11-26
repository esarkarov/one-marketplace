import type { ClientRequest, IncomingMessage, ServerResponse } from "node:http";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
} from "@opentelemetry/sdk-trace";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  loaded: [] as string[],
  warn: vi.fn(),
}));

vi.mock("@/config/logger.js", () => ({
  logger: { warn: hoisted.warn },
  registerLogEventListener: vi.fn(),
}));

vi.mock("@opentelemetry/sdk-node", () => {
  hoisted.loaded.push("@opentelemetry/sdk-node");
  return {};
});
vi.mock("@opentelemetry/sdk-metrics", () => {
  hoisted.loaded.push("@opentelemetry/sdk-metrics");
  return {};
});
vi.mock("@opentelemetry/exporter-trace-otlp-http", () => {
  hoisted.loaded.push("@opentelemetry/exporter-trace-otlp-http");
  return {};
});
vi.mock("@opentelemetry/exporter-metrics-otlp-http", () => {
  hoisted.loaded.push("@opentelemetry/exporter-metrics-otlp-http");
  return {};
});
vi.mock("@opentelemetry/instrumentation-http", () => {
  hoisted.loaded.push("@opentelemetry/instrumentation-http");
  return {};
});
vi.mock("@opentelemetry/instrumentation-express", () => {
  hoisted.loaded.push("@opentelemetry/instrumentation-express");
  return {};
});
vi.mock("@opentelemetry/instrumentation-pg", () => {
  hoisted.loaded.push("@opentelemetry/instrumentation-pg");
  return {};
});
vi.mock("@opentelemetry/instrumentation-amqplib", () => {
  hoisted.loaded.push("@opentelemetry/instrumentation-amqplib");
  return {};
});
vi.mock("@opentelemetry/instrumentation-redis", () => {
  hoisted.loaded.push("@opentelemetry/instrumentation-redis");
  return {};
});

const {
  errorDetailScrubber,
  isIgnoredIncomingRequest,
  redisStatement,
  scrubIncomingAttributes,
  scrubOutgoingAttributes,
  setActiveTelemetry,
  shutdownTelemetry,
  startTelemetry,
  tagRequestId,
  TELEMETRY_SHUTDOWN_TIMEOUT_MS,
} = await import("./sdk.js");

const offSettings = {
  mode: "off",
  endpoint: "http://127.0.0.1:4318",
  serviceName: "test",
} as const;

beforeEach(() => {
  hoisted.warn.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  setActiveTelemetry(null);
  vi.useRealTimers();
});

describe("startTelemetry with mode off", () => {
  it("returns false and never calls the loader", async () => {
    const load = vi.fn();

    await expect(startTelemetry(offSettings, load)).resolves.toBe(false);

    expect(load).not.toHaveBeenCalled();
  });

  it("imports no OpenTelemetry SDK, exporter or instrumentation module", async () => {
    await expect(startTelemetry(offSettings)).resolves.toBe(false);

    expect(hoisted.loaded).toEqual([]);
  });
});

describe("shutdownTelemetry", () => {
  it("does nothing when telemetry never started", async () => {
    await expect(shutdownTelemetry()).resolves.toBeUndefined();
    expect(hoisted.warn).not.toHaveBeenCalled();
  });

  it("returns after the bound when the flush hangs and warns once", async () => {
    vi.useFakeTimers();
    const shutdown = vi.fn(() => new Promise<void>(() => undefined));
    setActiveTelemetry({ shutdown });

    let settled = false;
    const done = shutdownTelemetry().then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(TELEMETRY_SHUTDOWN_TIMEOUT_MS - 1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await done;

    expect(TELEMETRY_SHUTDOWN_TIMEOUT_MS).toBe(2_000);
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(hoisted.warn).toHaveBeenCalledTimes(1);
    expect(hoisted.warn.mock.calls[0]![0]).toMatchObject({
      eventName: "telemetry.shutdown.timeout",
    });
  });

  it("warns and resolves when the flush fails, and runs only once", async () => {
    const shutdown = vi.fn(() => Promise.reject(new Error("collector down")));
    setActiveTelemetry({ shutdown });

    await expect(shutdownTelemetry()).resolves.toBeUndefined();
    await expect(shutdownTelemetry()).resolves.toBeUndefined();

    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(hoisted.warn).toHaveBeenCalledTimes(1);
    expect(hoisted.warn.mock.calls[0]![0]).toMatchObject({
      eventName: "telemetry.shutdown.failed",
    });
  });

  it("resolves without a warning when the flush succeeds", async () => {
    setActiveTelemetry({ shutdown: () => Promise.resolve() });

    await shutdownTelemetry();

    expect(hoisted.warn).not.toHaveBeenCalled();
  });
});

describe("span attribute scrubbing", () => {
  const exporter = new InMemorySpanExporter();
  const provider = new TracerProvider({
    spanProcessors: [
      errorDetailScrubber,
      new SimpleSpanProcessor({ exporter }),
    ],
  });

  afterEach(() => exporter.reset());

  it("drops exception messages, stack traces and status messages but keeps the error type", () => {
    const span = provider.getTracer("test").startSpan("middleware - jsonBody");
    span.recordException(
      new SyntaxError(
        'Unexpected token, "password": hunter2} is not valid JSON',
      ),
    );
    span.setStatus({ code: 2, message: "password hunter2" });
    span.end();

    const [finished] = exporter.getFinishedSpans();
    expect(JSON.stringify(finished!.events)).not.toContain("hunter2");
    expect(finished!.events[0]!.attributes).toStrictEqual({
      "exception.type": "SyntaxError",
    });
    expect(finished!.status).toStrictEqual({ code: 2 });
  });

  it("drops the path, query, client address, peer address and user agent from server spans", () => {
    const incoming = {
      "http.request.method": "GET",
      "url.path": "/api/v1/jobs/public",
      "url.query": "search=secret&limit=5",
      "client.address": "203.0.113.9",
      "network.peer.address": "203.0.113.9",
      "network.peer.port": 51234,
      "user_agent.original": "curl/8",
    };

    provider
      .getTracer("test")
      .startSpan("GET", {
        attributes: Object.assign(incoming, scrubIncomingAttributes()),
      })
      .end();

    const [span] = exporter.getFinishedSpans();
    expect(span!.attributes).toStrictEqual({
      "http.request.method": "GET",
    });
  });

  it("removes the query string from outgoing url.full and drops the user agent", () => {
    expect(
      scrubOutgoingAttributes({
        protocol: "https:",
        hostname: "api.stripe.com",
        path: "/v1/checkout/sessions?status=complete&customer_email=a@b.c",
      }),
    ).toStrictEqual({
      "url.full": "https://api.stripe.com/v1/checkout/sessions",
      "user_agent.original": undefined,
    });
    expect(
      scrubOutgoingAttributes({ hostname: "127.0.0.1", port: 4318 }),
    ).toMatchObject({ "url.full": "http://127.0.0.1:4318/" });
    expect(
      scrubOutgoingAttributes({ host: "api.daily.co:443", port: 443 }),
    ).toMatchObject({ "url.full": "http://api.daily.co:443/" });
  });

  it("tags the server span with the response request id", () => {
    const span = provider.getTracer("test").startSpan("GET");
    const response = {
      getHeader: (name: string) =>
        name === "x-request-id" ? "req-7" : undefined,
    } as unknown as ServerResponse;

    tagRequestId(span, {} as IncomingMessage, response);
    tagRequestId(span, {} as ClientRequest, {} as IncomingMessage);
    span.end();

    expect(exporter.getFinishedSpans()[0]!.attributes).toStrictEqual({
      "app.request_id": "req-7",
    });
  });

  it("keeps only the redis command name", () => {
    expect(redisStatement("GET")).toBe("GET");
  });

  it("ignores health and readiness probes with or without a query", () => {
    const request = (url: string) => ({ url }) as IncomingMessage;

    expect(isIgnoredIncomingRequest(request("/api/v1/health"))).toBe(true);
    expect(isIgnoredIncomingRequest(request("/api/v1/ready?x=1"))).toBe(true);
    expect(isIgnoredIncomingRequest(request("/api/v1/health/"))).toBe(true);
    expect(isIgnoredIncomingRequest(request("/api/v1/jobs/public"))).toBe(
      false,
    );
  });
});
