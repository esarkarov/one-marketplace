import { env } from "@/config/env.js";
import { logger } from "@/config/logger.js";
import { db } from "@/database/client.js";
import type { DbExecutor } from "@/database/database.types.js";
import { notificationEnvelopeSchema } from "@/infrastructure/events/notification.envelope.js";
import { sendNotification } from "@/infrastructure/events/notification.publisher.js";
import {
  isRabbitConnected,
  isRabbitEnabled,
} from "@/infrastructure/events/rabbitmq.client.js";
import type { NotificationInput } from "@/infrastructure/types/index.js";
import {
  errorCodeForLog,
  errorLogAttributes,
} from "@/shared/logging/sanitize-log.js";
import {
  OUTBOX_BACKOFF_BASE_MS,
  OUTBOX_BACKOFF_MAX_MS,
  OUTBOX_BATCH_BUDGET_MS,
  OUTBOX_BATCH_SIZE,
  OUTBOX_IDLE_INTERVAL_MS,
  OUTBOX_LAST_ERROR_MAX_LENGTH,
  OUTBOX_LEASE_MS,
  OUTBOX_MAX_ATTEMPTS,
  OUTBOX_RETENTION_BATCH_SIZE,
  OUTBOX_RETENTION_MS,
} from "@/modules/outbox/constants/outbox.constants.js";
import {
  claimOutboxEvents,
  deletePublishedOutboxEvents,
  insertOutboxEvent,
  markOutboxEventDead,
  markOutboxEventPublished,
  readOutboxStats,
  releaseOutboxEvent,
  scheduleOutboxEventRetry,
} from "@/modules/outbox/repositories/outbox.repository.js";
import type {
  ClaimedOutboxEvent,
  OutboxBatchResult,
  OutboxMode,
  OutboxNotificationInput,
  OutboxRelayDeps,
  OutboxStats,
} from "@/modules/outbox/types/outbox.types.js";
import {
  currentTraceparent,
  withRelaySpan,
} from "@/modules/outbox/utils/outbox.trace.js";
import { OutboxPayloadError } from "@/modules/outbox/utils/outbox.errors.js";

const payloadSchema = notificationEnvelopeSchema.shape.payload;

const defaultDeps: OutboxRelayDeps = {
  send: (input) => sendNotification(input),
  isReady: () => isRabbitConnected(),
};

let lastStats: OutboxStats | undefined;
let disabledWarned = false;

export const resolveOutboxMode = (): OutboxMode =>
  isRabbitEnabled() ? env.outboxMode : "off";

export const enqueueNotification = async (
  executor: DbExecutor,
  input: OutboxNotificationInput,
): Promise<boolean> => {
  const mode = resolveOutboxMode();
  if (mode === "off") return false;
  const { eventId, ...payload } = input;
  if (!payloadSchema.safeParse(payload).success) {
    throw new OutboxPayloadError(input.type);
  }
  await insertOutboxEvent(executor, {
    eventId,
    payload,
    traceparent: currentTraceparent(),
  });
  return mode === "on";
};

export const sendUnlessQueued = async (
  queued: boolean,
  input: NotificationInput,
): Promise<void> => {
  if (queued) return;
  await sendNotification(input);
};

export const outboxBackoffMs = (attempts: number): number =>
  Math.min(
    OUTBOX_BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1),
    OUTBOX_BACKOFF_MAX_MS,
  );

const truncateError = (value: string): string =>
  value.slice(0, OUTBOX_LAST_ERROR_MAX_LENGTH);

const errorCode = (error: unknown): string =>
  truncateError(
    errorCodeForLog(error) ??
      (error instanceof Error ? error.name : "UnknownError"),
  );

const safeLog = async (write: () => unknown): Promise<void> => {
  try {
    await write();
  } catch {
    return;
  }
};

const logDead = (event: ClaimedOutboxEvent, reason: string) =>
  safeLog(() =>
    logger.error({
      message: "Outbox event moved to DEAD",
      eventName: "outbox.event.dead",
      attributes: {
        "outbox.event_id": event.eventId,
        "outbox.attempts": event.attempts,
        reason,
      },
    }),
  );

const logLeaseLost = (event: ClaimedOutboxEvent) =>
  safeLog(() =>
    logger.warn({
      message: "Outbox event changed after its claim; result not recorded",
      eventName: "outbox.relay.lease_lost",
      attributes: {
        "outbox.event_id": event.eventId,
        "outbox.attempts": event.attempts,
      },
    }),
  );

const warnDisabledOnce = async () => {
  if (disabledWarned) return;
  disabledWarned = true;
  await safeLog(() =>
    logger.warn({
      message: "Outbox relay found RabbitMQ disabled; rows released",
      eventName: "outbox.relay.disabled",
    }),
  );
};

export const enqueueNotificationAfterCommit = async (
  input: OutboxNotificationInput,
): Promise<boolean> => {
  try {
    return await enqueueNotification(db, input);
  } catch (error) {
    await safeLog(() =>
      logger.warn({
        message: "Outbox enqueue failed; sending directly",
        eventName: "outbox.enqueue.failed",
        attributes: {
          "notification.type": input.type,
          "error.type": error instanceof Error ? error.name : "UnknownError",
          ...errorLogAttributes(error),
        },
      }),
    );
    return false;
  }
};

type RowOutcome = "published" | "retried" | "dead" | "released" | "stale";

interface RowResult {
  outcome: RowOutcome;
  publishFailed: boolean;
}

const recordFailure = async (
  event: ClaimedOutboxEvent,
  lastError: string,
): Promise<RowOutcome> => {
  if (event.attempts >= OUTBOX_MAX_ATTEMPTS) {
    const marked = await markOutboxEventDead(
      db,
      event.id,
      event.attempts,
      lastError,
    );
    if (!marked) return "stale";
    await logDead(event, lastError);
    return "dead";
  }
  const marked = await scheduleOutboxEventRetry(
    db,
    event.id,
    event.attempts,
    outboxBackoffMs(event.attempts),
    lastError,
  );
  return marked ? "retried" : "stale";
};

const markDeadWithoutSending = async (
  event: ClaimedOutboxEvent,
  reason: string,
): Promise<RowResult> => {
  const marked = await markOutboxEventDead(
    db,
    event.id,
    event.attempts,
    reason,
  );
  if (!marked) return { outcome: "stale", publishFailed: false };
  await logDead(event, reason);
  return { outcome: "dead", publishFailed: false };
};

const relayEvent = async (
  event: ClaimedOutboxEvent,
  deps: OutboxRelayDeps,
): Promise<RowResult> => {
  if (event.attempts > OUTBOX_MAX_ATTEMPTS) {
    return markDeadWithoutSending(event, "lease_expired_after_max_attempts");
  }
  const parsed = payloadSchema.safeParse(event.payload);
  if (!parsed.success) {
    return markDeadWithoutSending(event, "invalid_payload");
  }

  let result: Awaited<ReturnType<OutboxRelayDeps["send"]>>;
  let failure = "publish_failed";
  try {
    result = await withRelaySpan(event.traceparent, () =>
      deps.send({ ...parsed.data, eventId: event.eventId }),
    );
  } catch (error) {
    result = "failed";
    failure = errorCode(error);
  }

  if (result === "published") {
    const marked = await markOutboxEventPublished(db, event.id, event.attempts);
    return { outcome: marked ? "published" : "stale", publishFailed: false };
  }
  if (result === "disabled") {
    await warnDisabledOnce();
    const released = await releaseOutboxEvent(
      db,
      event.id,
      event.attempts,
      OUTBOX_IDLE_INTERVAL_MS,
    );
    return { outcome: released ? "released" : "stale", publishFailed: false };
  }
  return { outcome: await recordFailure(event, failure), publishFailed: true };
};

const releaseUnsent = async (
  events: ClaimedOutboxEvent[],
  result: OutboxBatchResult,
): Promise<void> => {
  for (const event of events) {
    const released = await releaseOutboxEvent(db, event.id, event.attempts, 0);
    result[released ? "released" : "stale"] += 1;
  }
};

export const relayOutboxBatch = async (
  deps: OutboxRelayDeps = defaultDeps,
): Promise<OutboxBatchResult> => {
  const result: OutboxBatchResult = {
    claimed: 0,
    published: 0,
    retried: 0,
    dead: 0,
    released: 0,
    stale: 0,
  };
  if (!deps.isReady()) return result;

  const events = await claimOutboxEvents(db, {
    limit: OUTBOX_BATCH_SIZE,
    leaseMs: OUTBOX_LEASE_MS,
  });
  result.claimed = events.length;
  const startedAt = Date.now();
  for (const [index, event] of events.entries()) {
    if (!deps.isReady() || Date.now() - startedAt >= OUTBOX_BATCH_BUDGET_MS) {
      await releaseUnsent(events.slice(index), result);
      break;
    }
    let row: RowResult;
    try {
      row = await relayEvent(event, deps);
    } catch (error) {
      await logOutboxRelayFailure(error);
      break;
    }
    result[row.outcome] += 1;
    if (row.outcome === "stale") await logLeaseLost(event);
    if (row.publishFailed) {
      await releaseUnsent(events.slice(index + 1), result);
      break;
    }
  }
  return result;
};

export const refreshOutboxStats = async (): Promise<OutboxStats> => {
  const stats = await readOutboxStats(db);
  lastStats = stats;
  return stats;
};

export const getOutboxStats = (): OutboxStats | undefined => lastStats;

export const sweepPublishedOutboxEvents = (): Promise<number> =>
  deletePublishedOutboxEvents(
    db,
    OUTBOX_RETENTION_MS,
    OUTBOX_RETENTION_BATCH_SIZE,
  );

export const logOutboxLag = (stats: OutboxStats): Promise<void> =>
  safeLog(() =>
    logger.warn({
      message: "Outbox has pending events older than the lag threshold",
      eventName: "outbox.relay.lag",
      attributes: {
        "outbox.pending": stats.pending,
        "outbox.oldest_pending_age_ms": stats.oldestPendingAgeMs,
        "outbox.dead": stats.dead,
      },
    }),
  );

export const logOutboxRelayFailure = (error: unknown): Promise<void> =>
  safeLog(() =>
    logger.error({
      message: "Outbox relay tick failed",
      eventName: "outbox.relay.failed",
      attributes: {
        "error.type": error instanceof Error ? error.name : "UnknownError",
        ...errorLogAttributes(error),
      },
    }),
  );
