import type { notifications } from "@/modules/notification-store/models/notification-store.model.js";

export type NotificationRow = typeof notifications.$inferSelect;

export interface NotificationInsertInput {
  eventId: string;
  recipientId: string | null;
  agencyId: string | null;
  type: string;
  title: string;
  message: string;
  link: string | null | undefined;
  metadata: Record<string, unknown> | null | undefined;
  createdAt: Date;
}
