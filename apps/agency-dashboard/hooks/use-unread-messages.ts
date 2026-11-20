"use client";

import { useAuth } from "@clerk/nextjs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { io } from "socket.io-client";
import { usePathname, useSearchParams } from "next/navigation";
import { playIncomingMessageSound, unlockMessageSound } from "./message-sound";

const locallyReadConversations = new Set<string>();

export const markConversationLocallyRead = (conversationId: string) =>
  locallyReadConversations.add(conversationId);

export const useUnreadMessages = () => {
  const { getToken, userId } = useAuth();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { data } = useQuery<{
    totalUnread: number;
    conversations: Array<{ id: string; unreadCount: number }>;
  }>({
    queryKey: ["agency-conversations"],
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/conversations?role=freelancer&scope=agency`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      return result.data;
    },
  });

  useEffect(() => {
    const unlock = () => {
      unlockMessageSound();
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    if (pathname === "/messages") return;
    let active = true;
    let socket: ReturnType<typeof io> | undefined;
    void getToken().then((token) => {
      if (!active || !token) return;
      socket = io(new URL(process.env.NEXT_PUBLIC_SERVER_URI!).origin, {
        auth: { token, role: "freelancer", scope: "agency" },
      });
      socket.on(
        "conversation:update",
        ({
          conversationId,
          senderId,
        }: {
          conversationId: string;
          senderId?: string | null;
        }) => {
          locallyReadConversations.delete(conversationId);
          if (senderId !== userId) playIncomingMessageSound();
          void queryClient.invalidateQueries({
            queryKey: ["agency-conversations"],
          });
        },
      );
    });

    return () => {
      active = false;
      socket?.disconnect();
    };
  }, [getToken, pathname, queryClient, userId]);

  const activeConversationId =
    pathname === "/messages" ? searchParams.get("conversationId") : null;
  const ignoredConversationIds = new Set(locallyReadConversations);
  if (activeConversationId) ignoredConversationIds.add(activeConversationId);
  const locallyReadUnread = (data?.conversations ?? []).reduce(
    (total, conversation) =>
      total +
      (ignoredConversationIds.has(conversation.id)
        ? conversation.unreadCount
        : 0),
    0,
  );

  return Math.max(0, (data?.totalUnread ?? 0) - locallyReadUnread);
};
