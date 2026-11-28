import { metrics } from "@opentelemetry/api";
import type { Attributes } from "@opentelemetry/api";
import { MeterProvider, MetricReader } from "@opentelemetry/sdk-metrics";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "@/config/logger.js";
import {
  COUNTED_LOG_EVENTS,
  registerGauge,
  reportExternalCall,
  startMetrics,
} from "./metrics.js";

class TestReader extends MetricReader {
  protected onShutdown(): Promise<void> {
    return Promise.resolve();
  }

  protected onForceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

let reader: TestReader;
let provider: MeterProvider;

interface Point {
  attributes: Attributes;
  value: unknown;
}

const dataPoints = async (name: string): Promise<Point[]> => {
  const { resourceMetrics } = await reader.collect();
  const points: Point[] = [];
  for (const metric of resourceMetrics.scopeMetrics.flatMap((s) => s.metrics)) {
    if (metric.descriptor.name !== name) continue;
    for (const point of metric.dataPoints) {
      points.push({ attributes: point.attributes, value: point.value });
    }
  }
  return points;
};

beforeEach(() => {
  reader = new TestReader();
  provider = new MeterProvider({ readers: [reader] });
  metrics.setGlobalMeterProvider(provider);
});

afterEach(async () => {
  await provider.shutdown();
  metrics.disable();
});

describe("log event counter", () => {
  it("counts cache.redis.degraded when the app logger writes it", async () => {
    const stop = startMetrics();

    await logger.warn({
      message: "Redis is degraded",
      eventName: "cache.redis.degraded",
      attributes: { op: "get", errorName: "TimeoutError" },
    });
    await logger.warning({
      message: "Redis is degraded",
      eventName: "cache.redis.degraded",
    });
    stop();

    const points = await dataPoints("app.log.events");
    expect(points).toHaveLength(1);
    expect(points[0]!.attributes).toStrictEqual({
      event_name: "cache.redis.degraded",
      level: "warn",
    });
    expect(points[0]!.value).toBe(2);
  });

  it("ignores names outside the allowlist and events without a name", async () => {
    const stop = startMetrics();

    await logger.info({ message: "listening", eventName: "system.startup" });
    await logger.error({ message: "no name" });
    stop();

    expect(await dataPoints("app.log.events")).toEqual([]);
  });

  it("stops counting once stopped", async () => {
    const stop = startMetrics();
    stop();

    await logger.warn({ message: "x", eventName: "redis.error" });

    expect(await dataPoints("app.log.events")).toEqual([]);
  });

  it("allowlists the 12 evaluated names and the five wave one names", () => {
    expect(COUNTED_LOG_EVENTS.size).toBe(21);
  });

  it("counts the outbox post-commit enqueue fallback", () => {
    expect(COUNTED_LOG_EVENTS.has("outbox.enqueue.failed")).toBe(true);
  });
});

describe("external call instruments", () => {
  it("records duration and attempts through the reserved observer", async () => {
    const stop = startMetrics();

    reportExternalCall({
      service: "stripe",
      operation: "refunds.create",
      outcome: "success",
      durationMs: 120,
      attempts: 2,
    });
    stop();
    reportExternalCall({
      service: "stripe",
      operation: "refunds.create",
      outcome: "success",
      durationMs: 1,
      attempts: 1,
    });

    const attempts = await dataPoints("app.external.call.attempts");
    expect(attempts.map((point) => point.value)).toEqual([2]);
    const durations = await dataPoints("app.external.call.duration");
    expect(durations).toHaveLength(1);
    expect(durations[0]!.attributes).toStrictEqual({
      service: "stripe",
      operation: "refunds.create",
      outcome: "success",
    });
  });
});

describe("registerGauge", () => {
  it("observes the callback value until removed", async () => {
    let value: number | undefined = 3;
    const callback = vi.fn(() => value);
    const remove = registerGauge("test.gauge", callback);

    expect((await dataPoints("test.gauge")).map((p) => p.value)).toEqual([3]);

    value = Number.NaN;
    expect((await dataPoints("test.gauge")).map((p) => p.value)).toEqual([3]);

    value = 4;
    expect((await dataPoints("test.gauge")).map((p) => p.value)).toEqual([4]);
    expect(callback).toHaveBeenCalledTimes(3);

    remove();
    value = 5;
    await dataPoints("test.gauge");
    expect(callback).toHaveBeenCalledTimes(3);
  });
});
