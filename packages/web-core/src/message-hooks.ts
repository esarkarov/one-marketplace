import { unwrap } from "@onemarketplace/api-client";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  MESSAGES_PAGE_SIZE,
  buildOptimisticMessage,
  flattenMessagePages,
  nextMessageCursor,
  optimisticId,
  reconcileSentMessage,
  removeMessage,
  updateLatestPage,
  withConversationPreview,
  withConversationRead,
  appendMessage,
  type ConversationsPageData,
  type MessagePagesData,
} from "./messages";
import { useApi, useApiConfig } from "./provider";
import { queryKeys } from "./query-keys";

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("File could not be read."));
    reader.readAsDataURL(file);
  });

export const useConversationMessages = (
  conversationId: string | undefined,
  enabled: boolean,
) => {
  const api = useApi();
  const { role, scope } = useApiConfig();
  const query = useInfiniteQuery({
    queryKey: queryKeys.conversationMessages(
      role,
      scope,
      conversationId ?? "none",
    ),
    enabled: enabled && Boolean(conversationId),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextMessageCursor,
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET("/api/v1/conversations/{conversationId}/messages", {
          params: {
            path: { conversationId: conversationId ?? "" },
            query: { cursor: pageParam, limit: MESSAGES_PAGE_SIZE },
          },
        }),
      ),
  });
  return { ...query, messages: flattenMessagePages(query.data?.pages ?? []) };
};

export const useSendMessage = (actorId: string | null) => {
  const api = useApi();
  const { role, scope } = useApiConfig();
  const queryClient = useQueryClient();
  const conversationsKey = [...queryKeys.conversationsAll(role, scope), "list"];

  return useMutation({
    mutationFn: async (input: {
      conversationId: string;
      body: string | null;
      file: File | null;
    }) => {
      const messagesKey = queryKeys.conversationMessages(
        role,
        scope,
        input.conversationId,
      );
      const placeholderId = optimisticId(
        `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      );
      await queryClient.cancelQueries({ queryKey: messagesKey });
      const now = new Date();
      queryClient.setQueryData<MessagePagesData>(messagesKey, (current) =>
        updateLatestPage(current, (messages) =>
          appendMessage(
            messages,
            buildOptimisticMessage({
              placeholderId,
              conversationId: input.conversationId,
              senderId: actorId,
              body: input.body,
              file: input.file,
              now,
            }),
          ),
        ),
      );
      queryClient.setQueriesData<ConversationsPageData>(
        { queryKey: conversationsKey },
        (page) =>
          withConversationPreview(page, input.conversationId, {
            body: input.body,
            attachmentName: input.file?.name ?? null,
            at: now.toISOString(),
          }),
      );
      try {
        const attachments = input.file
          ? [
              {
                fileUrl: await readFileAsDataUrl(input.file),
                fileName: input.file.name,
                fileSize: input.file.size,
                mimeType: input.file.type,
              },
            ]
          : [];
        const sent = await unwrap(
          api.POST("/api/v1/conversations/{conversationId}/messages", {
            params: {
              path: { conversationId: input.conversationId },
              query: {},
            },
            body: { body: input.body ?? undefined, attachments },
          }),
        );
        queryClient.setQueryData<MessagePagesData>(messagesKey, (current) =>
          reconcileSentMessage(current, placeholderId, sent),
        );
        return sent;
      } catch (error) {
        queryClient.setQueryData<MessagePagesData>(messagesKey, (current) =>
          current
            ? updateLatestPage(current, (messages) =>
                removeMessage(messages, placeholderId),
              )
            : current,
        );
        void queryClient.invalidateQueries({ queryKey: conversationsKey });
        throw error;
      }
    },
  });
};

export const useMarkConversationRead = () => {
  const api = useApi();
  const { role, scope } = useApiConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      conversationId: string;
      lastReadMessageId: string;
    }) =>
      unwrap(
        api.POST("/api/v1/conversations/{conversationId}/read", {
          params: { path: { conversationId: input.conversationId }, query: {} },
          body: { lastReadMessageId: input.lastReadMessageId },
        }),
      ),
    onMutate: (input) => {
      queryClient.setQueriesData<ConversationsPageData>(
        { queryKey: [...queryKeys.conversationsAll(role, scope), "list"] },
        (page) => withConversationRead(page, input.conversationId, 0),
      );
    },
    onError: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.conversationsAll(role, scope),
      });
    },
    onSuccess: (result) => {
      queryClient.setQueriesData<ConversationsPageData>(
        { queryKey: [...queryKeys.conversationsAll(role, scope), "list"] },
        (page) =>
          withConversationRead(page, result.conversationId, result.unreadCount),
      );
    },
  });
};

export const useStartMeeting = () => {
  const api = useApi();
  const { role, scope } = useApiConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) =>
      unwrap(
        api.POST("/api/v1/conversations/{conversationId}/meetings", {
          params: { path: { conversationId }, query: {} },
        }),
      ),
    onSuccess: (_result, conversationId) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.conversationsAll(role, scope),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.conversationMessages(role, scope, conversationId),
      });
    },
  });
};
