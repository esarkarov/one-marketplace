import { logger } from "@/config/logger.js";
import {
  OUTBOX_BATCH_SIZE,
  OUTBOX_IDLE_INTERVAL_MS,
  OUTBOX_LAG_LOG_INTERVAL_MS,
  OUTBOX_LAG_THRESHOLD_MS,
  OUTBOX_RETENTION_INTERVAL_MS,
  OUTBOX_STATS_INTERVAL_MS,
} from "./constants/outbox.constants.js";
import {
  logOutboxLag,
  logOutboxRelayFailure,
  refreshOutboxStats,
  relayOutboxBatch,
  sweepPublishedOutboxEvents,
} from "./services/outbox.service.js";

let running = false;
let timer: NodeJS.Timeout | undefined;
let inFlightRun: Promise<void> | undefined;
let lastStatsAt = Number.NEGATIVE_INFINITY;
let lastRetentionAt = Number.NEGATIVE_INFINITY;
let lastLagLogAt = Number.NEGATIVE_INFINITY;

const runMaintenance = async (): Promise<void> => {
  const now = Date.now();
  if (now - lastStatsAt >= OUTBOX_STATS_INTERVAL_MS) {
    lastStatsAt = now;
    const stats = await refreshOutboxStats();
    if (
      stats.oldestPendingAgeMs > OUTBOX_LAG_THRESHOLD_MS &&
      now - lastLagLogAt >= OUTBOX_LAG_LOG_INTERVAL_MS
    ) {
      lastLagLogAt = now;
      await logOutboxLag(stats);
    }
  }
  if (now - lastRetentionAt >= OUTBOX_RETENTION_INTERVAL_MS) {
    lastRetentionAt = now;
    await sweepPublishedOutboxEvents();
  }
};

const tick = async (): Promise<boolean> => {
  let fullBatch = false;
  try {
    const result = await relayOutboxBatch();
    fullBatch = result.claimed >= OUTBOX_BATCH_SIZE;
  } catch (error) {
    await logOutboxRelayFailure(error);
  }
  try {
    await runMaintenance();
  } catch (error) {
    await logOutboxRelayFailure(error);
  }
  return fullBatch;
};

const schedule = (delayMs: number): void => {
  if (!running) return;
  timer = setTimeout(() => {
    timer = undefined;
    const run: Promise<void> = tick().then((fullBatch) => {
      if (inFlightRun === run) inFlightRun = undefined;
      schedule(fullBatch ? 0 : OUTBOX_IDLE_INTERVAL_MS);
    });
    inFlightRun = run;
  }, delayMs);
  timer.unref();
};

export const startOutboxRelay = (): void => {
  if (running) return;
  running = true;
  lastStatsAt = Number.NEGATIVE_INFINITY;
  lastRetentionAt = Number.NEGATIVE_INFINITY;
  lastLagLogAt = Number.NEGATIVE_INFINITY;
  schedule(0);
  void logger.info({
    message: "Outbox relay started",
    eventName: "outbox.relay.started",
    attributes: { "outbox.idle_interval_ms": OUTBOX_IDLE_INTERVAL_MS },
  });
};

export const stopOutboxRelay = (): void => {
  running = false;
  clearTimeout(timer);
  timer = undefined;
};

export const waitForOutboxRelayRun = async (): Promise<void> => {
  await inFlightRun;
};
