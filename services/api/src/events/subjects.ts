export const NOTIFICATIONS_STREAM = "NOTIFICATIONS";
export const NOTIFICATIONS_SUBJECT = "notifications.created";
export const NOTIFICATIONS_CONSUMER = "notification-storage";

export type NotificationEvent = {
  eventId: string;
  type: string;
  title: string;
  message: string;
  link?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
} & (
  | { recipientId: string; agencyId?: undefined }
  | { recipientId?: undefined; agencyId: string }
);
