import { and, desc, eq, or, sql } from "drizzle-orm";
import type { DbExecutor } from "../../database/db-executor.js";
import { notifications } from "./notifications.schema.js";

export const findLatestNotifications = (
  executor: DbExecutor,
  userId: string,
  agencyId: string | null,
) =>
  executor
    .select()
    .from(notifications)
    .where(
      agencyId
        ? eq(notifications.agency_id, agencyId)
        : eq(notifications.recipient_id, userId),
    )
    .orderBy(desc(notifications.created_at))
    .limit(10);

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

export const insertNotificationIfNew = (
  executor: DbExecutor,
  input: {
    eventId: string;
    recipientId: string | null;
    agencyId: string | null;
    type: string;
    title: string;
    message: string;
    link: string | null | undefined;
    metadata: Record<string, unknown> | null | undefined;
    createdAt: Date;
  },
) =>
  executor
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

export const pingDatabase = (executor: DbExecutor) =>
  executor.execute(sql`select 1`);
