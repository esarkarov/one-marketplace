import { metrics } from "@opentelemetry/api";
import { MeterProvider, MetricReader } from "@opentelemetry/sdk-metrics";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  registerEventLoopGauge,
  registerOutboxGauges,
  registerPoolGauges,
  type OutboxGaugeValues,
} from "./gauges.js";

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

const values = async (): Promise<Record<string, unknown>> => {
  const { resourceMetrics } = await reader.collect();
  return Object.fromEntries(
    resourceMetrics.scopeMetrics
      .flatMap((scope) => scope.metrics)
      .filter((metric) => metric.dataPoints.length > 0)
      .map((metric) => [metric.descriptor.name, metric.dataPoints[0]!.value]),
  );
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

describe("registerPoolGauges", () => {
  it("reports the live pool counts and stops after removal", async () => {
    const pool = { totalCount: 4, idleCount: 1, waitingCount: 0 };
    const remove = registerPoolGauges(pool);

    expect(await values()).toEqual({
      "db.pool.total": 4,
      "db.pool.idle": 1,
      "db.pool.waiting": 0,
    });

    pool.waitingCount = 7;
    expect((await values())["db.pool.waiting"]).toBe(7);

    remove();
    pool.waitingCount = 9;
    expect((await values())["db.pool.waiting"]).toBe(7);
  });
});

describe("registerEventLoopGauge", () => {
  it("reports a non-negative p99 delay in milliseconds and stops after removal", async () => {
    const remove = registerEventLoopGauge();
    await new Promise((resolve) => setTimeout(resolve, 80));

    const p99 = (await values())["nodejs.eventloop.delay.p99"];
    expect(typeof p99).toBe("number");
    expect(p99 as number).toBeGreaterThanOrEqual(0);

    remove();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect((await values())["nodejs.eventloop.delay.p99"]).toBe(p99);
  });
});

describe("registerOutboxGauges", () => {
  it("reports nothing before the first stats read, then the latest stats", async () => {
    const source: { stats?: OutboxGaugeValues } = {};
    const remove = registerOutboxGauges(() => source.stats);

    expect(await values()).toEqual({});

    source.stats = { pending: 3, oldestPendingAgeMs: 61_000, dead: 1 };
    expect(await values()).toEqual({
      "outbox.pending": 3,
      "outbox.oldest_pending_age_ms": 61_000,
      "outbox.dead": 1,
    });

    remove();
  });
});
