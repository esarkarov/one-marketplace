import type { ChannelWrapper } from "amqp-connection-manager";
import {
  getRabbitPublishChannel,
  isRabbitConnected,
  isRabbitEnabled,
} from "../config/rabbitmq.js";
import { logger } from "../config/logger.js";
import { errorLogAttributes } from "../utils/sanitize-log.js";
import {
  createNotificationEnvelope,
  NOTIFICATION_CREATED_TYPE,
  type NotificationEnvelope,
  type NotificationInput,
} from "./envelope.js";
import {
  NOTIFICATIONS_CREATED_ROUTING_KEY,
  topologyNames,
} from "./topology.js";

export const PUBLISH_TIMEOUT_MS = 2_000;

export const publishNotificationEnvelope = async (
  channel: ChannelWrapper,
  envelope: NotificationEnvelope,
  prefix = "",
): Promise<void> => {
  const body = Buffer.from(JSON.stringify(envelope));
  const options = {
    persistent: true,
    deliveryMode: 2,
    contentType: "application/json",
    messageId: envelope.id,
    type: envelope.type,
    timestamp: Math.floor(Date.parse(envelope.occurredAt) / 1000),
    timeout: PUBLISH_TIMEOUT_MS,
  };
  const exchange = topologyNames(prefix).exchange;

  for (let attempt = 1; ; attempt++) {
    try {
      await channel.publish(
        exchange,
        NOTIFICATIONS_CREATED_ROUTING_KEY,
        body,
        options,
      );
      return;
    } catch (error) {
      if (attempt >= 2) throw error;
    }
  }
};

const logSafely = async (write: () => unknown): Promise<void> => {
  try {
    await write();
  } catch {
    return;
  }
};

export type SendNotificationResult = "published" | "disabled" | "failed";

export const sendNotification = async (
  input: NotificationInput,
): Promise<SendNotificationResult> => {
  if (!isRabbitEnabled()) return "disabled";

  if (!isRabbitConnected()) {
    await logSafely(() =>
      logger.warn({
        message: "Notification event skipped",
        eventName: "queue.publish.skipped",
        attributes: {
          "messaging.system": "rabbitmq",
          "messaging.destination.name": NOTIFICATION_CREATED_TYPE,
          reason: "disconnected",
        },
      }),
    );
    return "failed";
  }

  try {
    const envelope = createNotificationEnvelope(input);
    await publishNotificationEnvelope(getRabbitPublishChannel(), envelope);
    return "published";
  } catch (error) {
    await logSafely(() =>
      logger.error({
        message: "Notification event could not be published",
        eventName: "queue.publish.failed",
        attributes: {
          "messaging.system": "rabbitmq",
          "messaging.destination.name": NOTIFICATION_CREATED_TYPE,
          "error.type": error instanceof Error ? error.name : "UnknownError",
          ...errorLogAttributes(error),
        },
      }),
    );
    return "failed";
  }
};
