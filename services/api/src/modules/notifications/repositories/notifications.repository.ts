import { desc, eq } from "drizzle-orm";
import type { DbExecutor } from "@/database/database.types.js";
import { accounts } from "@/modules/auth/models/auth.model.js";
import {
  insertNotification,
  type NotificationInsertInput,
} from "@/modules/notification-store/index.js";
import { notifications } from "@/modules/notification-store/models/notification-store.model.js";

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

export const insertNotificationIfNew = async (
  executor: DbExecutor,
  input: NotificationInsertInput,
) => {
  const notification = await insertNotification(executor, input);
  const inserted = notification ? [notification] : [];
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
