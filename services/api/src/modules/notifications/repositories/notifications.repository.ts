import { and, desc, eq, or } from "drizzle-orm";
import type { DbExecutor } from "../../../database/database.types.js";
import { accounts } from "../../auth/models/auth.model.js";
import { notifications } from "../models/notifications.model.js";

export const findLatestNotifications = (
  executor: DbExecutor,
  userId: string,
  agencyId: string | null,
  page: { limit: number; offset: number },
) =>
  executor
    .select({
      notification: notifications,
      recipientAccountId: accounts.id,
    })
    .from(notifications)
    .leftJoin(accounts, eq(accounts.auth_id, notifications.recipient_id))
    .where(
      agencyId
        ? eq(notifications.agency_id, agencyId)
        : eq(notifications.recipient_id, userId),
    )
    .orderBy(desc(notifications.created_at), desc(notifications.id))
    .limit(page.limit)
    .offset(page.offset);

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

export const insertNotificationIfNew = async (
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
) => {
  const inserted = await executor
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
  if (!input.recipientId || !inserted.length) {
    return inserted.map((notification) => ({
      notification,
      recipientAccountId: null,
    }));
  }
  const [account] = await executor
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.auth_id, input.recipientId))
    .limit(1);
  return inserted.map((notification) => ({
    notification,
    recipientAccountId: account?.id ?? null,
  }));
};
