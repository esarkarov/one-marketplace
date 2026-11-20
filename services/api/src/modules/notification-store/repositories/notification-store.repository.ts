import { and, eq, or } from "drizzle-orm";
import type { DbExecutor } from "@/database/database.types.js";
import { notifications } from "@/modules/notification-store/models/notification-store.model.js";
import type { NotificationInsertInput } from "@/modules/notification-store/types/notification-store.types.js";

export const insertNotification = async (
  executor: DbExecutor,
  input: NotificationInsertInput,
) => {
  const [inserted] = await executor
    .insert(notifications)
    .values({
      event_id: input.eventId,
      recipient_id: input.recipientId,
      agency_id: input.agencyId,
      type: input.type,
      title: input.title,
      message: input.message,
      link: input.link,
      metadata: input.metadata,
      created_at: input.createdAt,
    })
    .onConflictDoNothing({ target: notifications.event_id })
    .returning();
  return inserted ?? null;
};

export const markAllNotificationsRead = (
  executor: DbExecutor,
  userId: string,
  agencyId: string | null,
) =>
  executor
    .update(notifications)
    .set({ is_read: true, read_at: new Date() })
    .where(
      agencyId
        ? eq(notifications.agency_id, agencyId)
        : eq(notifications.recipient_id, userId),
    );

export const markNotificationReadForRecipient = (
  executor: DbExecutor,
  userId: string,
  notificationId: string,
  agencyId: string | null,
) =>
  executor
    .update(notifications)
    .set({ is_read: true, read_at: new Date() })
    .where(
      and(
        eq(notifications.id, notificationId),
        agencyId
          ? or(
              eq(notifications.recipient_id, userId),
              eq(notifications.agency_id, agencyId),
            )
          : eq(notifications.recipient_id, userId),
      ),
    )
    .returning({ id: notifications.id });
