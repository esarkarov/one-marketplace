"use client";

import { useAuth } from "@clerk/nextjs";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  type Notification,
} from "@onemarketplace/web-core";
import { format } from "timeago.js";
import type { NotificationCategory } from "@/app/_components/notifications/types";
import {
  notificationCategory,
  notificationHref,
} from "@/lib/notification-routes";

export type { Notification };

const icons: Record<NotificationCategory, string> = {
  Contracts: "solar:check-circle-linear",
  Proposals: "solar:document-text-linear",
  Messages: "solar:chat-round-dots-linear",
  Payments: "solar:wallet-money-linear",
  Account: "solar:bell-linear",
};

export const presentNotification = (notification: Notification) => {
  const category = notificationCategory(notification.type);
  const createdAt = notification.createdAt
    ? new Date(notification.createdAt)
    : new Date();
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (date: Date, target: Date) =>
    date.toDateString() === target.toDateString();

  return {
    ...notification,
    category,
    icon: icons[category],
    description: notification.message,
    href: notificationHref(notification.type, notification.link),
    unread: !notification.isRead,
    time: format(createdAt),
    date: sameDay(createdAt, today)
      ? "Today"
      : sameDay(createdAt, yesterday)
        ? "Yesterday"
        : "Earlier",
  };
};

export const useClientNotifications = () => {
  const { isSignedIn } = useAuth();
  const query = useNotifications({ enabled: Boolean(isSignedIn) });
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  return {
    notifications: query.data?.results ?? [],
    isLoading: query.isLoading,
    markRead: markRead.mutate,
    markAllRead: () => markAllRead.mutate(),
  };
};
