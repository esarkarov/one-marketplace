import { logger } from "@/config/logger.js";
import { db } from "@/database/client.js";
import type { NotificationRow } from "@/modules/notification-store/index.js";
import { findAccountIdByAuthId } from "@/modules/notifications/repositories/notifications.repository.js";
import {
  emitAgencyNotification,
  emitNotification,
} from "@/modules/notifications/services/notifications.sse.js";
import { toNotificationResponse } from "@/modules/notifications/utils/notifications.mappers.js";
import { errorCodeForLog } from "@/shared/logging/sanitize-log.js";

export const pushNotification = (
  notification: NotificationRow,
  recipientAccountId: string | null,
) => {
  const payload = toNotificationResponse(
    notification,
    recipientAccountId,
    "notifications_stream",
  );
  if (notification.agency_id) {
    emitAgencyNotification(notification.agency_id, payload);
  } else {
    emitNotification(notification.recipient_id!, payload);
  }
};

export const pushStoredNotification = async (
  notification: NotificationRow,
): Promise<void> => {
  try {
    const recipientAccountId = notification.recipient_id
      ? await findAccountIdByAuthId(db, notification.recipient_id)
      : null;
    pushNotification(notification, recipientAccountId);
  } catch (error) {
    try {
      const code = errorCodeForLog(error);
      await logger.warn({
        message: "Stored notification push failed",
        eventName: "notifications.push.failed",
        attributes: {
          "error.type": error instanceof Error ? error.name : "UnknownError",
          ...(code === undefined ? {} : { "error.code": code }),
        },
      });
    } catch {}
  }
};
