import { monitorEventLoopDelay } from "node:perf_hooks";
import { registerGauge } from "./metrics.js";

export interface PoolCounts {
  readonly totalCount: number;
  readonly idleCount: number;
  readonly waitingCount: number;
}

export interface OutboxGaugeValues {
  readonly pending: number;
  readonly oldestPendingAgeMs: number;
  readonly dead: number;
}

const EVENT_LOOP_RESOLUTION_MS = 20;
const NANOSECONDS_PER_MILLISECOND = 1_000_000;

export const registerPoolGauges = (pool: PoolCounts): (() => void) => {
  const removers = [
    registerGauge("db.pool.total", () => pool.totalCount),
    registerGauge("db.pool.idle", () => pool.idleCount),
    registerGauge("db.pool.waiting", () => pool.waitingCount),
  ];
  return () => removers.forEach((remove) => remove());
};

export const registerEventLoopGauge = (): (() => void) => {
  const histogram = monitorEventLoopDelay({
    resolution: EVENT_LOOP_RESOLUTION_MS,
  });
  histogram.enable();
  const remove = registerGauge(
    "nodejs.eventloop.delay.p99",
    () => {
      if (histogram.count === 0) return undefined;
      const p99 = histogram.percentile(99) / NANOSECONDS_PER_MILLISECOND;
      histogram.reset();
      return p99;
    },
    "ms",
  );
  return () => {
    remove();
    histogram.disable();
  };
};

export const registerOutboxGauges = (
  read: () => OutboxGaugeValues | undefined,
): (() => void) => {
  const removers = [
    registerGauge("outbox.pending", () => read()?.pending),
    registerGauge(
      "outbox.oldest_pending_age_ms",
      () => read()?.oldestPendingAgeMs,
      "ms",
    ),
    registerGauge("outbox.dead", () => read()?.dead),
  ];
  return () => removers.forEach((remove) => remove());
};
