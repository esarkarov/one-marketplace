import { db } from "../../../database/client.js";
import {
  findLatestNotifications,
  markAllNotificationsRead,
  markNotificationReadForRecipient,
} from "../repositories/notifications.repository.js";
import { toNotificationResponse } from "../utils/notifications.mappers.js";

export const getNotifications = async (
  userId: string,
  agencyId: string | null,
) =>
  (await findLatestNotifications(db, userId, agencyId)).map(
    toNotificationResponse,
  );

export const readAllNotifications = (userId: string, agencyId: string | null) =>
  markAllNotificationsRead(db, userId, agencyId);

export const readNotification = (
  userId: string,
  notificationId: string,
  agencyId: string | null,
) => markNotificationReadForRecipient(db, userId, notificationId, agencyId);
