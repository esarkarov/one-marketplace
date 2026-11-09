import { AckPolicy, ConsumerMessages, JsMsg, JSONCodec } from "nats";
import {
  NotificationEvent,
  NOTIFICATIONS_CONSUMER,
  NOTIFICATIONS_STREAM,
  NOTIFICATIONS_SUBJECT,
} from "./subjects.js";
import { db } from "../database/client.js";
import { notifications } from "../database/schema.js";
import {
  emitAgencyNotification,
  emitNotification,
} from "../modules/notifications/notification.sse.js";
import { getNats } from "../config/nats.js";
import { logger } from "../config/logger.js";
import { errorLogAttributes } from "../utils/sanitize-log.js";

const codec = JSONCodec<NotificationEvent>();
const buffer: Array<{ event: NotificationEvent; message: JsMsg }> = [];
let flushing = false;
let messages: ConsumerMessages | undefined;

const flush = async () => {
  if (flushing || !buffer.length) return;
  flushing = true;
  const batch = buffer.splice(0, 100);

  try {
    const inserted = await db
      .insert(notifications)
      .values(
        batch.map(({ event }) => ({
          event_id: event.eventId,
          recipient_id: event.recipientId ?? null,
          agency_id: event.agencyId ?? null,
          type: event.type,
          title: event.title,
          message: event.message,
          link: event.link,
          metadata: event.metadata,
          created_at: new Date(event.createdAt),
        })),
      )
      .onConflictDoNothing({ target: notifications.event_id })
      .returning();

    batch.forEach(({ message }) => message.ack());
    inserted.forEach((notification) =>
      notification.agency_id
        ? emitAgencyNotification(notification.agency_id, notification)
        : emitNotification(notification.recipient_id!, notification),
    );
  } catch (error) {
    await logger.error({
      message: "Message processing failed",
      eventName: "queue.message.failed",
      attributes: {
        "messaging.system": "nats",
        "messaging.destination.name": NOTIFICATIONS_SUBJECT,
        "queue.batch_size": batch.length,
        "error.type": error instanceof Error ? error.name : "UnknownError",
        ...errorLogAttributes(error),
      },
    });
    batch.forEach(({ message }) => message.nak(2_000));
  } finally {
    flushing = false;
    if (buffer.length >= 100) void flush();
  }
};

export const startNotificationConsumer = async () => {
  const nats = await getNats();
  const manager = await nats.jetstreamManager();

  try {
    await manager.streams.info(NOTIFICATIONS_STREAM);
  } catch {
    await manager.streams.add({
      name: NOTIFICATIONS_STREAM,
      subjects: [NOTIFICATIONS_SUBJECT],
    });
  }

  try {
    await manager.consumers.info(NOTIFICATIONS_STREAM, NOTIFICATIONS_CONSUMER);
  } catch {
    await manager.consumers.add(NOTIFICATIONS_STREAM, {
      durable_name: NOTIFICATIONS_CONSUMER,
      ack_policy: AckPolicy.Explicit,
      ack_wait: 30_000_000_000,
      filter_subject: NOTIFICATIONS_SUBJECT,
    });
  }

  const consumer = await nats
    .jetstream()
    .consumers.get(NOTIFICATIONS_STREAM, NOTIFICATIONS_CONSUMER);

  messages = await consumer.consume({
    callback: (message) => {
      try {
        buffer.push({ event: codec.decode(message.data), message });
        if (buffer.length >= 100) void flush();
      } catch {
        message.term();
      }
    },
  });
};

setInterval(() => void flush(), 2_000).unref();

export const stopNotificationConsumer = async () => {
  await flush();
  await messages?.close();
};
