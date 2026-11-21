"use client";

import { useAuth } from "@clerk/nextjs";
import { useConversations } from "@onemarketplace/web-core";

export const useUnreadMessages = () => {
  const { isSignedIn } = useAuth();
  const { data } = useConversations({ enabled: Boolean(isSignedIn) });
  return data?.totalUnread ?? 0;
};
