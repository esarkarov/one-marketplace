import { db } from "../../../database/client.js";
import {
  findLatestNotifications,
  markAllNotificationsRead,
  markNotificationReadForRecipient,
} from "../repositories/notifications.repository.js";

export const getNotifications = (userId: string, agencyId: string | null) =>
  findLatestNotifications(db, userId, agencyId);

export const readAllNotifications = (userId: string, agencyId: string | null) =>
  markAllNotificationsRead(db, userId, agencyId);

export const readNotification = (
  userId: string,
  notificationId: string,
  agencyId: string | null,
) => markNotificationReadForRecipient(db, userId, notificationId, agencyId);
