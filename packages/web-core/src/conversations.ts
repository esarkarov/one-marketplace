import { unwrap } from "@onemarketplace/api-client";
import { useQuery } from "@tanstack/react-query";
import type { ConversationSummary } from "./messaging-socket";
import { useApi, useApiConfig } from "./provider";
import { queryKeys, type PageParams } from "./query-keys";

export interface ConversationsPage {
  results: ConversationSummary[];
  hasMore: boolean;
  totalUnread: number;
}

export interface UseConversationsOptions extends PageParams {
  enabled?: boolean;
}

/**
 * The inbox query. `useUnreadMessages` reads the same default query key, so a
 * header badge and the inbox share one request.
 */
export const useConversations = (options: UseConversationsOptions = {}) => {
  const api = useApi();
  const { role, scope } = useApiConfig();
  const { limit = 20, offset = 0, enabled = true } = options;

  return useQuery({
    queryKey: queryKeys.conversations(role, scope, { limit, offset }),
    queryFn: (): Promise<ConversationsPage> =>
      unwrap(
        api.GET("/api/v1/conversations", {
          params: { query: { limit, offset } },
        }),
      ),
    enabled,
  });
};

/** `totalUnread` of GET /conversations (counts every conversation, not just the page). */
export const useUnreadMessages = () => {
  const query = useConversations();
  return { count: query.data?.totalUnread ?? 0, status: query.status };
};
