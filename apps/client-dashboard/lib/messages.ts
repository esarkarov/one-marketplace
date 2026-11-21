import type { Components } from "@onemarketplace/api-client";
import { errorMessage, isApiError } from "@onemarketplace/api-client";
import { formatDistanceToNow } from "date-fns";
import type {
  ClientConversation,
  ClientMessage,
} from "../app/_components/data/client-data";
import { isHttpsUrl } from "./url";

export type ConversationItem = Components["schemas"]["MessagingConversation"];
export type MessageItem = Components["schemas"]["MessagingMessage"];
export type MessageAttachmentItem =
  Components["schemas"]["MessagingMessageAttachment"];

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
export const ATTACHMENT_SIZE_MESSAGE = "The maximum attachment size is 5 MB.";

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

export const counterpartyOf = (
  participants: ConversationItem["participants"],
): ConversationItem["participants"][number] | undefined =>
  participants.find(({ participantType }) => participantType !== "CLIENT") ??
  participants[0];

export const initialsOfName = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => Array.from(part)[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

export const lastMessagePreview = (conversation: ConversationItem): string =>
  conversation.lastMessage?.body ??
  conversation.lastMessage?.eventType ??
  (conversation.lastAttachmentName
    ? `Attachment – ${conversation.lastAttachmentName}`
    : null) ??
  "Conversation started";

const relative = (iso: string): string =>
  formatDistanceToNow(new Date(iso), { addSuffix: true });

export const toConversationView = (
  conversation: ConversationItem,
  selectedId: string | undefined,
  formatTime: (iso: string) => string = relative,
): ClientConversation => {
  const person = counterpartyOf(conversation.participants);
  const name = person?.name ?? "Freelancer";
  const active =
    conversation.contractStatus === "ACTIVE" && conversation.contractId;
  return {
    id: conversation.id,
    person: name,
    avatarUrl: person?.avatarUrl ?? null,
    initials: initialsOfName(name),
    accountType: person?.participantType === "AGENCY" ? "Agency" : "Freelancer",
    context: conversation.jobTitle ?? "Direct conversation",
    contextHref: active
      ? `/contracts?contractId=${encodeURIComponent(conversation.contractId ?? "")}`
      : conversation.jobId
        ? `/proposals/${encodeURIComponent(conversation.jobId)}`
        : "/proposals",
    contextLabel: active ? "View contract details" : "View project details",
    unread: conversation.id === selectedId ? 0 : conversation.unreadCount,
    lastMessage: lastMessagePreview(conversation),
    time: conversation.lastMessageAt
      ? formatTime(conversation.lastMessageAt)
      : "New",
    messages: [],
    activeMeeting: conversation.activeMeeting
      ? {
          id: conversation.activeMeeting.id,
          joinUrl: conversation.activeMeeting.joinUrl,
          startedAt: conversation.activeMeeting.startedAt,
        }
      : null,
  };
};

export const isCounterpartyTyping = (
  typingIds: readonly string[],
  actorId: string | null,
): boolean => typingIds.some((id) => id !== actorId);

const payloadString = (
  payload: MessageItem["eventPayload"],
  key: string,
): string | undefined => {
  const value = payload?.[key];
  return typeof value === "string" ? value : undefined;
};

const payloadCents = (
  payload: MessageItem["eventPayload"],
  key: string,
): number => {
  const value = payload?.[key];
  return typeof value === "number" && Number.isSafeInteger(value) ? value : 0;
};

const isSystem = (message: MessageItem, eventType: string): boolean =>
  message.messageType === "SYSTEM_EVENT" && message.eventType === eventType;

const HIDDEN_EVENTS: readonly string[] = [
  "CONTRACT_ACCEPTED",
  "MILESTONE_APPROVED",
  "MILESTONE_CHANGES_REQUESTED",
];

const contractHref = (contractId: string | undefined): string =>
  contractId
    ? `/contracts?contractId=${encodeURIComponent(contractId)}`
    : "/contracts";

export const toThread = (
  messages: readonly MessageItem[],
  actorId: string | null,
  formatTime: (iso: string) => string = relative,
): ClientMessage[] => {
  const activeContracts = new Set<string>();
  const completedContracts = new Set<string>();
  const endedMeetings = new Set<string>();
  const submissionOfMilestone = new Map<string, string>();
  const submissionStatus = new Map<
    string,
    "Submitted" | "Approved" | "Changes requested"
  >();

  for (const message of messages) {
    const payload = message.eventPayload;
    if (isSystem(message, "MILESTONE_SUBMITTED")) {
      const milestoneId = payloadString(payload, "milestoneId");
      if (milestoneId) {
        submissionOfMilestone.set(milestoneId, message.id);
        submissionStatus.set(message.id, "Submitted");
      }
    }
    if (isSystem(message, "CONTRACT_ACCEPTED")) {
      const contractId = payloadString(payload, "contractId");
      if (contractId) activeContracts.add(contractId);
    }
    if (isSystem(message, "CONTRACT_COMPLETED")) {
      const contractId = payloadString(payload, "contractId");
      if (contractId) {
        completedContracts.add(contractId);
        activeContracts.delete(contractId);
      }
    }
    if (isSystem(message, "MEETING_ENDED")) {
      const meetingId = payloadString(payload, "meetingId");
      if (meetingId) endedMeetings.add(meetingId);
    }
    if (
      message.eventType === "MILESTONE_APPROVED" ||
      message.eventType === "MILESTONE_CHANGES_REQUESTED"
    ) {
      const milestoneId = payloadString(payload, "milestoneId");
      const submissionId = milestoneId
        ? submissionOfMilestone.get(milestoneId)
        : undefined;
      if (submissionId) {
        submissionStatus.set(
          submissionId,
          message.eventType === "MILESTONE_APPROVED"
            ? "Approved"
            : "Changes requested",
        );
      }
    }
  }

  const result: ClientMessage[] = [];
  for (const message of messages) {
    const payload = message.eventPayload;
    const time = formatTime(message.createdAt);
    const system = message.messageType === "SYSTEM_EVENT";
    const mine = actorId !== null && message.senderId === actorId;

    if (
      system &&
      message.eventType &&
      HIDDEN_EVENTS.includes(message.eventType)
    ) {
      continue;
    }

    if (isSystem(message, "CONTRACT_COMPLETED")) {
      const contractId = payloadString(payload, "contractId");
      result.push({
        id: message.id,
        kind: "contract_completed",
        sender: "system",
        contractId,
        title: payloadString(payload, "title") ?? "Contract completed",
        href: contractHref(contractId),
        time,
      });
      continue;
    }

    if (isSystem(message, "CONTRACT_OFFER")) {
      const contractId = payloadString(payload, "contractId");
      const first = payload?.firstMilestone;
      const firstCents =
        first && typeof first === "object"
          ? payloadCents(first as Record<string, unknown>, "amountCents")
          : 0;
      result.push({
        id: message.id,
        kind: "contract",
        sender: "client",
        title: payloadString(payload, "title") ?? "Contract offer",
        amountCents: firstCents,
        status:
          contractId && completedContracts.has(contractId)
            ? "Completed"
            : contractId && activeContracts.has(contractId)
              ? "Active"
              : "Awaiting acceptance",
        href: contractHref(contractId),
        time,
      });
      continue;
    }

    if (
      isSystem(message, "MILESTONE_SUBMITTED") ||
      isSystem(message, "MILESTONE_FUNDED") ||
      isSystem(message, "MILESTONE_ADDED")
    ) {
      const contractId = payloadString(payload, "contractId");
      const link = payloadString(payload, "submissionDeliveryLink");
      result.push({
        id: message.id,
        kind: "milestone",
        sender:
          message.eventType === "MILESTONE_SUBMITTED" ? "talent" : "client",
        title:
          payloadString(payload, "milestoneTitle") ?? "Milestone submitted",
        amountCents: payloadCents(payload, "amountCents"),
        status:
          message.eventType === "MILESTONE_ADDED"
            ? "Added"
            : message.eventType === "MILESTONE_FUNDED"
              ? "Funded"
              : (submissionStatus.get(message.id) ?? "Submitted"),
        href: contractHref(contractId),
        time,
        contractId,
        milestoneId: payloadString(payload, "milestoneId"),
        submissionMessage:
          payloadString(payload, "submissionMessage") ??
          payloadString(payload, "requirements"),
        submissionDeliveryLink: link && isHttpsUrl(link) ? link : undefined,
        dueDate: payloadString(payload, "dueDate"),
      });
      continue;
    }

    if (isSystem(message, "MEETING_STARTED")) {
      const meetingId = payloadString(payload, "meetingId");
      const joinUrl = payloadString(payload, "joinUrl");
      result.push({
        id: message.id,
        kind: "meeting",
        sender: mine ? "client" : "talent",
        title: "Video meeting",
        startsAt: `Started ${formatTime(message.createdAt)}`,
        meetUrl: joinUrl && isHttpsUrl(joinUrl) ? joinUrl : "",
        ended: meetingId ? endedMeetings.has(meetingId) : false,
        time,
      });
      continue;
    }

    if (isSystem(message, "MEETING_ENDED")) {
      const minutes = payload?.durationMinutes;
      result.push({
        id: message.id,
        kind: "meeting_ended",
        durationMinutes: typeof minutes === "number" ? minutes : 0,
        time,
      });
      continue;
    }

    const attachment = message.attachments[0];
    result.push({
      id: message.id,
      kind: "text",
      sender: mine ? "client" : "talent",
      text: message.body ?? "Shared an attachment.",
      time,
      replyToId: message.replyToMessageId ?? undefined,
      attachment: attachment
        ? {
            name: attachment.fileName,
            size: formatFileSize(attachment.fileSize),
            type: attachment.mimeType,
            url:
              attachment.fileUrl && isHttpsUrl(attachment.fileUrl)
                ? attachment.fileUrl
                : undefined,
          }
        : undefined,
    });
  }
  return result;
};
