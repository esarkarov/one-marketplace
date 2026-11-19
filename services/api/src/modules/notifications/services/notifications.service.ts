import { db } from "@/database/client.js";
import {
  fetchSize,
  toOffsetPage,
} from "@/shared/validation/utils/pagination.utils.js";
import {
  findLatestNotifications,
  markAllNotificationsRead,
  markNotificationReadForRecipient,
} from "@/modules/notifications/repositories/notifications.repository.js";
import { toNotificationResponse } from "@/modules/notifications/utils/notifications.mappers.js";

export const getNotifications = async (
  userId: string,
  agencyId: string | null,
  { limit, offset }: { limit: number; offset: number },
) => {
  const { rows, hasMore } = toOffsetPage(
    await findLatestNotifications(db, userId, agencyId, {
      limit: fetchSize(limit),
      offset,
    }),
    limit,
  );
  return {
    results: rows.map(({ notification, recipientAccountId }) =>
      toNotificationResponse(
        notification,
        recipientAccountId,
        "notifications_get",
      ),
    ),
    hasMore,
  };
};

export const readAllNotifications = (userId: string, agencyId: string | null) =>
  markAllNotificationsRead(db, userId, agencyId);

export const readNotification = (
  userId: string,
  notificationId: string,
  agencyId: string | null,
) => markNotificationReadForRecipient(db, userId, notificationId, agencyId);
