import { logger } from "@/config/logger.js";
import type { NotificationRow } from "@/modules/notification-store/types/notification-store.types.js";

export type NotificationPusher = (row: NotificationRow) => Promise<void>;

let pusher: NotificationPusher | null = null;

export const registerNotificationPusher = (
  next: NotificationPusher | null,
): void => {
  pusher = next;
};

export const pushStoredNotification = async (
  row: NotificationRow,
): Promise<void> => {
  const current = pusher;
  try {
    if (!current) {
      await logger.debug({
        message: "No notification pusher registered. Push skipped.",
        eventName: "notifications.push.no_pusher",
      });
      return;
    }
    await current(row);
  } catch {}
};
