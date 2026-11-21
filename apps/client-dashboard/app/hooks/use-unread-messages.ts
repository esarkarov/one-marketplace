"use client";

import { useAuth } from "@clerk/nextjs";
import { useConversations } from "@onemarketplace/web-core";
import { usePathname, useSearchParams } from "next/navigation";

const locallyReadConversations = new Set<string>();

export const markConversationLocallyRead = (conversationId: string) =>
  locallyReadConversations.add(conversationId);

export const useUnreadMessages = () => {
  const { isSignedIn } = useAuth();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data } = useConversations({ enabled: Boolean(isSignedIn) });

  const activeConversationId =
    pathname === "/messages" ? searchParams.get("conversationId") : null;
  const ignoredConversationIds = new Set(locallyReadConversations);
  if (activeConversationId) ignoredConversationIds.add(activeConversationId);
  const locallyReadUnread = (data?.results ?? []).reduce(
    (total, conversation) =>
      total +
      (ignoredConversationIds.has(conversation.id)
        ? conversation.unreadCount
        : 0),
    0,
  );

  return Math.max(0, (data?.totalUnread ?? 0) - locallyReadUnread);
};
