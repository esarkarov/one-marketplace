import { requirePublicId } from "../../../shared/ids/public-ids.js";

interface NotificationRow {
  id: string;
  event_id: string;
  recipient_id: string | null;
  agency_id: string | null;
  type: string;
  title: string;
  message: string;
  link: string | null;
  metadata: Record<string, unknown> | null;
  is_read: boolean;
  read_at: Date | null;
  created_at: Date | null;
}

export const toNotificationResponse = (
  notification: NotificationRow,
  recipientAccountId: string | null | undefined,
  operation: string,
) => ({
  id: notification.id,
  eventId: notification.event_id,
  recipientId:
    notification.recipient_id === null
      ? null
      : requirePublicId(recipientAccountId, operation, notification.id),
  agencyId: notification.agency_id,
  type: notification.type,
  title: notification.title,
  message: notification.message,
  link: notification.link,
  metadata: notification.metadata,
  isRead: notification.is_read,
  readAt: notification.read_at,
  createdAt: notification.created_at,
});
