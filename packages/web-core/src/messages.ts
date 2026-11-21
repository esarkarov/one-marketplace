import type { Components } from "@onemarketplace/api-client";
import { errorMessage, isApiError } from "@onemarketplace/api-client";

export type ConversationItem = Components["schemas"]["MessagingConversation"];
export type MessageItem = Components["schemas"]["MessagingMessage"];

export interface ConversationsPageData {
  results: ConversationItem[];
  hasMore: boolean;
  totalUnread: number;
}

export interface MessagePageData {
  results: MessageItem[];
  nextCursor: string | null;
}

export interface MessagePagesData {
  pages: MessagePageData[];
  pageParams: (string | undefined)[];
}

export const MESSAGES_PAGE_SIZE = 30;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const ALLOWED_ATTACHMENT_TYPES: readonly string[] = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
export const ATTACHMENT_TYPE_MESSAGE =
  "Use PDF, DOCX, PNG, JPG, or TXT files only.";
const MAX_ATTACHMENT_MB = MAX_ATTACHMENT_BYTES / (1024 * 1024);
export const ATTACHMENT_SIZE_MESSAGE = `The maximum attachment size is ${MAX_ATTACHMENT_MB} MB.`;
export const ATTACHMENT_HINT = `PDF, DOCX, PNG, JPG, or TXT · Maximum ${MAX_ATTACHMENT_MB} MB`;

const OPTIMISTIC_PREFIX = "optimistic-";

export const optimisticId = (seed: number | string): string =>
  `${OPTIMISTIC_PREFIX}${seed}`;

export const isOptimisticId = (id: string): boolean =>
  id.startsWith(OPTIMISTIC_PREFIX);

export const messageErrorMessage = (error: unknown): string => {
  const message = errorMessage(error);
  return isApiError(error) && error.requestId
    ? `${message} (reference ${error.requestId})`
    : message;
};

export const validateAttachment = (file: {
  type: string;
  size: number;
}): string | null => {
  if (!ALLOWED_ATTACHMENT_TYPES.includes(file.type)) {
    return ATTACHMENT_TYPE_MESSAGE;
  }
  if (file.size > MAX_ATTACHMENT_BYTES) return ATTACHMENT_SIZE_MESSAGE;
  return null;
};

export const formatFileSize = (bytes: number): string =>
  bytes < 1024 * 1024
    ? `${Math.max(0.1, bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export const dedupeMessages = (
  messages: readonly MessageItem[],
): MessageItem[] => {
  const seen = new Set<string>();
  const result: MessageItem[] = [];
  for (const message of messages) {
    if (seen.has(message.id)) continue;
    seen.add(message.id);
    result.push(message);
  }
  return result;
};

export const flattenMessagePages = (
  pages: readonly MessagePageData[],
): MessageItem[] =>
  dedupeMessages(
    pages
      .slice()
      .reverse()
      .flatMap((page) => page.results),
  );

export const nextMessageCursor = (page: MessagePageData): string | undefined =>
  page.nextCursor ?? undefined;

export const updateLatestPage = (
  current: MessagePagesData | undefined,
  update: (messages: MessageItem[]) => MessageItem[],
): MessagePagesData =>
  current && current.pages.length > 0
    ? {
        ...current,
        pages: current.pages.map((page, index) =>
          index === 0 ? { ...page, results: update(page.results) } : page,
        ),
      }
    : {
        pages: [{ results: update([]), nextCursor: null }],
        pageParams: [undefined],
      };

export const appendMessage = (
  messages: MessageItem[],
  message: MessageItem,
): MessageItem[] =>
  messages.some(({ id }) => id === message.id)
    ? messages
    : [...messages, message];

export const removeMessage = (
  messages: MessageItem[],
  id: string,
): MessageItem[] => messages.filter((message) => message.id !== id);

export const reconcileSentMessage = (
  data: MessagePagesData | undefined,
  placeholderId: string,
  sent: MessageItem,
): MessagePagesData => {
  const serverExists = (data?.pages ?? []).some((page) =>
    page.results.some(({ id }) => id === sent.id),
  );
  const pages = (data?.pages ?? []).map((page) => ({
    ...page,
    results: page.results.flatMap((message) => {
      if (message.id !== placeholderId) return [message];
      return serverExists ? [] : [sent];
    }),
  }));
  const placed = pages.some((page) =>
    page.results.some(({ id }) => id === sent.id),
  );
  if (placed && data) return { ...data, pages };
  return updateLatestPage(data ? { ...data, pages } : data, (messages) =>
    appendMessage(messages, sent),
  );
};

export const buildOptimisticMessage = (input: {
  placeholderId: string;
  conversationId: string;
  senderId: string | null;
  body: string | null;
  file: { name: string; size: number; type: string } | null;
  now?: Date;
}): MessageItem => ({
  id: input.placeholderId,
  conversationId: input.conversationId,
  senderId: input.senderId,
  messageType: "USER",
  body: input.body,
  eventType: null,
  eventPayload: null,
  createdAt: (input.now ?? new Date()).toISOString(),
  replyTo: null,
  replyToMessageId: null,
  attachments: input.file
    ? [
        {
          id: input.placeholderId,
          messageId: input.placeholderId,
          attachmentType: "FILE",
          createdAt: (input.now ?? new Date()).toISOString(),
          fileName: input.file.name,
          fileSize: input.file.size,
          fileUrl: "",
          isAvailable: false,
          mimeType: input.file.type,
          storageKey: "",
        },
      ]
    : [],
});

export const latestServerMessageId = (
  messages: readonly MessageItem[],
): string | null =>
  messages.findLast(({ id }) => !isOptimisticId(id))?.id ?? null;

export const readMarkKey = (
  conversationId: string,
  messageId: string,
): string => `${conversationId}:${messageId}`;

export const withConversationRead = (
  page: ConversationsPageData | undefined,
  conversationId: string,
  unreadCount = 0,
): ConversationsPageData | undefined => {
  if (!page) return page;
  const target = page.results.find(({ id }) => id === conversationId);
  if (!target) return page;
  const cleared = Math.max(0, target.unreadCount - unreadCount);
  return {
    ...page,
    totalUnread: Math.max(0, page.totalUnread - cleared),
    results: page.results.map((conversation) =>
      conversation.id === conversationId
        ? { ...conversation, unreadCount }
        : conversation,
    ),
  };
};

export const withConversationPreview = (
  page: ConversationsPageData | undefined,
  conversationId: string,
  preview: { body: string | null; attachmentName: string | null; at: string },
): ConversationsPageData | undefined =>
  page
    ? {
        ...page,
        results: page.results.map((conversation) =>
          conversation.id === conversationId
            ? {
                ...conversation,
                lastMessage: conversation.lastMessage
                  ? {
                      ...conversation.lastMessage,
                      body: preview.body,
                      eventType: null,
                    }
                  : null,
                lastAttachmentName: preview.attachmentName,
                lastMessageAt: preview.at,
              }
            : conversation,
        ),
      }
    : page;

export const shouldPlayMessageSound = (
  payload: { messagesChanged: boolean; senderId: string | null },
  isMine: (senderId: string | null) => boolean,
): boolean => payload.messagesChanged && !isMine(payload.senderId);

export const isCounterpartyTyping = (
  typingIds: readonly string[],
  actorId: string | null,
): boolean => typingIds.some((id) => id !== actorId);
