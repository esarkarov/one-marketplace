"use client";

import { NotificationCategory } from "@/app/_components/notifications/types";
import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { format } from "timeago.js";

export type Notification = {
  id: string;
  type: string;
  title: string;
  message: string;
  link: string | null;
  is_read: boolean;
  created_at: string;
};

const categoryFor = (type: string): NotificationCategory => {
  const value = type.toLowerCase();
  if (value.includes("payment")) return "Payments";
  if (value.includes("message")) return "Messages";
  if (value.includes("proposal") || value.includes("interview"))
    return "Proposals";
  if (value.includes("contract") || value.includes("milestone"))
    return "Contracts";
  return "Account";
};

const icons: Record<NotificationCategory, string> = {
  Contracts: "solar:check-circle-linear",
  Proposals: "solar:document-text-linear",
  Messages: "solar:chat-round-dots-linear",
  Payments: "solar:wallet-money-linear",
  Account: "solar:bell-linear",
};

export const presentNotification = (notification: Notification) => {
  const category = categoryFor(notification.type);
  const createdAt = new Date(notification.created_at);
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
    href: notification.link || "/notifications",
    unread: !notification.is_read,
    time: format(createdAt),
    date: sameDay(createdAt, today)
      ? "Today"
      : sameDay(createdAt, yesterday)
        ? "Yesterday"
        : "Earlier",
  };
};

export const useNotifications = () => {
  const { getToken, isLoaded, userId } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery<Notification[]>({
    queryKey: ["notifications"],
    enabled: isLoaded && Boolean(userId),
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/notifications?role=client`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      return result.data;
    },
  });

  const updateRead = (id?: string) =>
    queryClient.setQueryData<Notification[]>(
      ["notifications"],
      (current = []) =>
        current.map((item) =>
          !id || item.id === id ? { ...item, is_read: true } : item,
        ),
    );

  const requestRead = async (path: string) => {
    const token = await getToken();
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SERVER_URI}/notifications/${path}?role=client`,
      { method: "PATCH", headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) throw new Error("Notification could not be updated.");
  };

  const markRead = useMutation({
    mutationFn: (id: string) => requestRead(`${id}/read`),
    onSuccess: (_, id) => updateRead(id),
  });

  const markAllRead = useMutation({
    mutationFn: () => requestRead(`read-all`),
    onSuccess: () => updateRead(),
  });

  return {
    notifications: query.data ?? [],
    isLoading: query.isLoading,
    markRead: markRead.mutate,
    markAllRead: markAllRead.mutate,
  };
};

export const useNotificationStream = () => {
  const { getToken, isLoaded, userId } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isLoaded || !userId) return;
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout>;

    const connect = async () => {
      try {
        const token = await getToken();
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_SERVER_URI}/notifications/stream?role=client`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
          },
        );

        if (!response.ok || !response.body) throw new Error("SSE unavailable");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = "";

        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          pending += decoder.decode(value, { stream: true });
          const events = pending.split("\n\n");
          pending = events.pop() ?? "";

          events.forEach((event) => {
            if (!event.startsWith("event: notification")) return;
            const data = event
              .split("\n")
              .find((line) => line.startsWith("data: "));
            if (!data) return;
            const notification = JSON.parse(data.slice(6)) as Notification;
            queryClient.setQueryData<Notification[]>(
              ["notifications"],
              (current = []) => [
                notification,
                ...current.filter((item) => item.id !== notification.id),
              ],
            );
          });
        }
      } catch (error) {
        if (!controller.signal.aborted) retry = setTimeout(connect, 3_000);
      }
    };

    void connect();
    return () => {
      controller.abort();
      clearTimeout(retry);
    };
  }, [getToken, isLoaded, queryClient, userId]);
};
