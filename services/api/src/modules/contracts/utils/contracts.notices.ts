import type { DbExecutor } from "@/database/database.types.js";
import {
  insertNotification,
  notificationEventId,
  pushStoredNotification,
} from "@/modules/notification-store/index.js";

interface ContractNoticeInput {
  type: string;
  entityId: string;
  transition: string;
  recipientId: string | null;
  agencyId: string | null;
  title: string;
  message: string;
  link: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export const insertContractNotice = (
  executor: DbExecutor,
  input: ContractNoticeInput,
) =>
  insertNotification(executor, {
    eventId: notificationEventId(input.type, input.entityId, input.transition),
    recipientId: input.agencyId ? null : input.recipientId,
    agencyId: input.agencyId,
    type: input.type,
    title: input.title,
    message: input.message,
    link: input.link,
    metadata: input.metadata,
    createdAt: input.createdAt,
  });

export type ContractNotice = Awaited<ReturnType<typeof insertContractNotice>>;

export const pushContractNotice = async (notice: ContractNotice) => {
  if (notice) await pushStoredNotification(notice);
};
