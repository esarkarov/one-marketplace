import type { ChannelWrapper } from "amqp-connection-manager";
import type { ConsumeMessage } from "amqplib";
import { sql } from "drizzle-orm";
import { getRabbitConsumerChannel } from "../config/rabbitmq.js";
import { logger } from "../config/logger.js";
import { db } from "../database/client.js";
import { notifications } from "../database/schema.js";
import {
  emitAgencyNotification,
  emitNotification,
} from "../modules/notifications/notification.sse.js";
import { errorCodeForLog, errorLogAttributes } from "../utils/sanitize-log.js";
import { notificationEnvelopeSchema } from "./envelope.js";
import { DEFAULT_DELIVERY_LIMIT, topologyNames } from "./topology.js";

const PREFETCH = 10;
const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const MAX_TRACKED_FAILURES = 1_000;

const isPermanentDatabaseError = (error: unknown): boolean =>
  /^2[23]/.test(errorCodeForLog(error) ?? "");

export const createNotificationConsumer = (options: {
  channel: ChannelWrapper;
  prefix?: string;
  deliveryLimit?: number;
}) => {
  const { channel } = options;
  const queue = topologyNames(options.prefix).storageQueue;
  const inFlight = new Set<Promise<void>>();
  let consumerTag: string | undefined;
  let resumeTimer: NodeJS.Timeout | undefined;
  let paused = false;
  let stopped = false;
  let attempt = 0;
  const failures = new Map<string, number>();
  const deliveryLimit = options.deliveryLimit ?? DEFAULT_DELIVERY_LIMIT;

  const logFailure = async (
    message: string,
    eventName: string,
    error?: unknown,
  ) => {
    try {
      await logger.error({
        message,
        eventName,
        attributes: {
          "messaging.system": "rabbitmq",
          "messaging.destination.name": queue,
          ...(error === undefined
            ? {}
            : {
                "error.type":
                  error instanceof Error ? error.name : "UnknownError",
                ...errorLogAttributes(error),
              }),
        },
      });
    } catch {}
  };

  const logInfo = async (message: string, eventName: string) => {
    try {
      await logger.info({
        message,
        eventName,
        attributes: {
          "messaging.system": "rabbitmq",
          "messaging.destination.name": queue,
        },
      });
    } catch {}
  };

  const settle = async (action: () => void) => {
    try {
      action();
    } catch (error) {
      await logFailure(
        "Message acknowledgement failed",
        "queue.ack.failed",
        error,
      );
    }
  };

  const subscribe = async () => {
    const result = await channel.consume(queue, (message) => track(message), {
      prefetch: PREFETCH,
      noAck: false,
    });
    consumerTag = result.consumerTag;
  };

  const scheduleResume = () => {
    const delay = Math.min(MIN_BACKOFF_MS * 2 ** attempt++, MAX_BACKOFF_MS);
    resumeTimer = setTimeout(async () => {
      if (stopped) return;
      try {
        await db.execute(sql`select 1`);
        await subscribe();
        if (stopped) {
          const tag = consumerTag;
          consumerTag = undefined;
          if (tag) await channel.cancel(tag).catch(() => undefined);
          return;
        }
        paused = false;
        await logInfo(
          "Notification consumer resumed",
          "queue.consumer.resumed",
        );
      } catch {
        scheduleResume();
      }
    }, delay);
    resumeTimer.unref();
  };

  const pause = async () => {
    if (paused || stopped) return;
    paused = true;
    await logInfo("Notification consumer paused", "queue.consumer.paused");
    const tag = consumerTag;
    consumerTag = undefined;
    if (tag) await channel.cancel(tag).catch(() => undefined);
    if (!stopped) scheduleResume();
  };

  const handle = async (message: ConsumeMessage) => {
    const parsed = (() => {
      try {
        return notificationEnvelopeSchema.safeParse(
          JSON.parse(message.content.toString("utf8")),
        );
      } catch {
        return undefined;
      }
    })();

    if (!parsed?.success) {
      await logFailure("Invalid message rejected", "queue.message.invalid");
      await settle(() => channel.nack(message, false, false));
      return;
    }

    const { id, occurredAt, payload } = parsed.data;

    let inserted;
    try {
      inserted = await db
        .insert(notifications)
        .values({
          event_id: id,
          recipient_id: payload.recipientId ?? null,
          agency_id: payload.agencyId ?? null,
          type: payload.type,
          title: payload.title,
          message: payload.message,
          link: payload.link,
          metadata: payload.metadata,
          created_at: new Date(occurredAt),
        })
        .onConflictDoNothing({ target: notifications.event_id })
        .returning();
    } catch (error) {
      await logFailure(
        "Message processing failed",
        "queue.message.failed",
        error,
      );
      const failedAttempts = (failures.get(id) ?? 0) + 1;
      const exhausted = failedAttempts >= deliveryLimit;
      const permanent = isPermanentDatabaseError(error);
      if (exhausted || permanent) {
        failures.delete(id);
      } else {
        failures.delete(id);
        failures.set(id, failedAttempts);
        if (failures.size > MAX_TRACKED_FAILURES) {
          failures.delete(failures.keys().next().value!);
        }
      }
      if (!permanent) await pause();
      await settle(() =>
        channel.nack(message, false, !(exhausted || permanent)),
      );
      return;
    }

    failures.delete(id);
    attempt = 0;
    await settle(() => channel.ack(message));
    try {
      for (const notification of inserted) {
        if (notification.agency_id) {
          emitAgencyNotification(notification.agency_id, notification);
        } else {
          emitNotification(notification.recipient_id!, notification);
        }
      }
    } catch (error) {
      await logFailure("Notification push failed", "queue.push.failed", error);
    }
  };

  const track = (message: ConsumeMessage) => {
    if (stopped) {
      void settle(() => channel.nack(message, false, true));
      return;
    }
    const task: Promise<void> = handle(message)
      .catch(() => undefined)
      .finally(() => inFlight.delete(task));
    inFlight.add(task);
  };

  return {
    start: async () => {
      await subscribe();
      await logInfo("Notification consumer started", "queue.consumer.started");
    },
    stop: async (timeoutMs = 5_000) => {
      stopped = true;
      clearTimeout(resumeTimer);
      const tag = consumerTag;
      consumerTag = undefined;
      if (tag) await channel.cancel(tag).catch(() => undefined);

      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        Promise.allSettled([...inFlight]),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, timeoutMs);
        }),
      ]);
      clearTimeout(timer);
    },
  };
};

let consumer: ReturnType<typeof createNotificationConsumer> | undefined;

export const startNotificationConsumer = async () => {
  consumer = createNotificationConsumer({
    channel: getRabbitConsumerChannel(),
  });
  await consumer.start();
};

export const stopNotificationConsumer = async (timeoutMs?: number) => {
  await consumer?.stop(timeoutMs);
  consumer = undefined;
};
