import { ApiError } from "@onemarketplace/api-client";
import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_HINT,
  ATTACHMENT_SIZE_MESSAGE,
  MAX_ATTACHMENT_BYTES,
  appendMessage,
  buildOptimisticMessage,
  dedupeMessages,
  flattenMessagePages,
  formatFileSize,
  isCounterpartyTyping,
  isOptimisticId,
  latestServerMessageId,
  messageErrorMessage,
  optimisticId,
  reconcileSentMessage,
  removeMessage,
  shouldPlayMessageSound,
  updateLatestPage,
  validateAttachment,
  withConversationPreview,
  withConversationRead,
  type ConversationItem,
  type ConversationsPageData,
  type MessageItem,
  type MessagePagesData,
} from "./messages";

const ME = "11111111-1111-4111-8111-111111111111";

const THEM = "22222222-2222-4222-8222-222222222222";

const CONVERSATION = "33333333-3333-4333-8333-333333333333";

const at = (minute: number) =>
  `2026-11-21T10:${String(minute).padStart(2, "0")}:00.000Z`;

const message = (
  id: string,
  overrides: Partial<MessageItem> = {},
): MessageItem => ({
  id,
  conversationId: CONVERSATION,
  senderId: THEM,
  messageType: "USER",
  body: `body ${id}`,
  eventType: null,
  eventPayload: null,
  createdAt: at(1),
  replyTo: null,
  replyToMessageId: null,
  attachments: [],
  ...overrides,
});

const conversation = (
  overrides: Partial<ConversationItem> = {},
): ConversationItem => ({
  id: CONVERSATION,
  activeMeeting: null,
  contractId: null,
  contractStatus: null,
  jobId: "job-1",
  jobTitle: "Build a site",
  lastAttachmentName: null,
  lastMessage: null,
  lastMessageAt: at(5),
  participants: [
    {
      participantType: "CLIENT",
      name: "Me Client",
      avatarUrl: null,
      companyName: null,
      professionalTitle: null,
    },
    {
      participantType: "FREELANCER",
      name: "Ada Lovelace",
      avatarUrl: "https://img.example/ada.png",
      companyName: null,
      professionalTitle: "Engineer",
    },
  ],
  proposalId: null,
  unreadCount: 3,
  updatedAt: at(5),
  ...overrides,
});

const pages = (...results: MessageItem[][]): MessagePagesData => ({
  pages: results.map((list, index) => ({
    results: list,
    nextCursor: index < results.length - 1 ? `cursor-${index}` : null,
  })),
  pageParams: results.map((_, index) =>
    index === 0 ? undefined : `cursor-${index - 1}`,
  ),
});

describe("dedupe and pages", () => {
  it("keeps the first occurrence of an id and the order", () => {
    const list = [message("a"), message("b"), message("a"), message("c")];
    expect(dedupeMessages(list).map(({ id }) => id)).toEqual(["a", "b", "c"]);
  });

  it("puts older pages first and drops ids that overlap between pages", () => {
    const data = pages(
      [message("c"), message("d")],
      [message("a"), message("b"), message("c")],
    );
    expect(flattenMessagePages(data.pages).map(({ id }) => id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("appends a message once", () => {
    const list = [message("a")];
    expect(appendMessage(list, message("b")).map(({ id }) => id)).toEqual([
      "a",
      "b",
    ]);
    expect(appendMessage(list, message("a"))).toBe(list);
  });

  it("updates only the newest page and creates one for an empty cache", () => {
    const data = pages([message("c")], [message("a")]);
    const next = updateLatestPage(data, (list) => [...list, message("d")]);
    expect(next.pages[0]?.results.map(({ id }) => id)).toEqual(["c", "d"]);
    expect(next.pages[1]?.results.map(({ id }) => id)).toEqual(["a"]);
    const fresh = updateLatestPage(undefined, (list) => [
      ...list,
      message("x"),
    ]);
    expect(fresh.pages).toHaveLength(1);
    expect(fresh.pages[0]?.nextCursor).toBeNull();
  });

  it("removes a message by id", () => {
    expect(
      removeMessage([message("a"), message("b")], "a").map(({ id }) => id),
    ).toEqual(["b"]);
  });

  it("finds the last server message id and skips optimistic ones", () => {
    const placeholder = optimisticId("1");
    expect(isOptimisticId(placeholder)).toBe(true);
    expect(isOptimisticId("abc")).toBe(false);
    expect(
      latestServerMessageId([message("a"), message("b"), message(placeholder)]),
    ).toBe("b");
    expect(latestServerMessageId([message(placeholder)])).toBeNull();
    expect(latestServerMessageId([])).toBeNull();
  });
});

describe("optimistic send reconcile", () => {
  const placeholder = optimisticId("p1");
  const optimistic = buildOptimisticMessage({
    placeholderId: placeholder,
    conversationId: CONVERSATION,
    senderId: ME,
    body: "hello",
    file: null,
    now: new Date(at(9)),
  });
  const sent = message("server-1", { senderId: ME, body: "hello" });

  it("builds a placeholder with an attachment preview", () => {
    expect(optimistic).toMatchObject({
      id: placeholder,
      senderId: ME,
      messageType: "USER",
      body: "hello",
      attachments: [],
      createdAt: at(9),
    });
    const withFile = buildOptimisticMessage({
      placeholderId: placeholder,
      conversationId: CONVERSATION,
      senderId: ME,
      body: null,
      file: { name: "a.pdf", size: 2048, type: "application/pdf" },
    });
    expect(withFile.attachments[0]).toMatchObject({
      fileName: "a.pdf",
      fileSize: 2048,
      mimeType: "application/pdf",
    });
  });

  it("replaces the placeholder with the server message", () => {
    const data = pages([message("a"), optimistic]);
    const next = reconcileSentMessage(data, placeholder, sent);
    expect(next.pages[0]?.results.map(({ id }) => id)).toEqual([
      "a",
      "server-1",
    ]);
  });

  it("drops the placeholder when a refetch already delivered the server message", () => {
    const data = pages([message("a"), sent, optimistic]);
    const next = reconcileSentMessage(data, placeholder, sent);
    expect(next.pages[0]?.results.map(({ id }) => id)).toEqual([
      "a",
      "server-1",
    ]);
  });

  it("keeps the server message when a refetch replaced the whole list", () => {
    const data = pages([message("a")]);
    const next = reconcileSentMessage(data, placeholder, sent);
    expect(next.pages[0]?.results.map(({ id }) => id)).toEqual([
      "a",
      "server-1",
    ]);
  });

  it("does not duplicate when the server message is on an older page", () => {
    const data = pages([optimistic], [sent]);
    const next = reconcileSentMessage(data, placeholder, sent);
    expect(
      flattenMessagePages(next.pages).filter(({ id }) => id === "server-1"),
    ).toHaveLength(1);
    expect(next.pages[0]?.results).toEqual([]);
  });

  it("creates a page when the cache is empty", () => {
    const next = reconcileSentMessage(undefined, placeholder, sent);
    expect(next.pages[0]?.results.map(({ id }) => id)).toEqual(["server-1"]);
  });
});

describe("conversation cache updates", () => {
  const page = (): ConversationsPageData => ({
    results: [
      conversation({ unreadCount: 3 }),
      conversation({ id: "other", unreadCount: 2 }),
    ],
    hasMore: false,
    totalUnread: 5,
  });

  it("clears the unread count and lowers the total", () => {
    const next = withConversationRead(page(), CONVERSATION, 0);
    expect(next?.totalUnread).toBe(2);
    expect(next?.results[0]?.unreadCount).toBe(0);
    expect(next?.results[1]?.unreadCount).toBe(2);
  });

  it("uses the unread count the server returned", () => {
    const next = withConversationRead(page(), CONVERSATION, 1);
    expect(next?.totalUnread).toBe(3);
    expect(next?.results[0]?.unreadCount).toBe(1);
  });

  it("never goes below zero and ignores an unknown conversation", () => {
    const small = { ...page(), totalUnread: 1 };
    expect(withConversationRead(small, CONVERSATION, 0)?.totalUnread).toBe(0);
    const unchanged = page();
    expect(withConversationRead(unchanged, "missing", 0)).toBe(unchanged);
    expect(withConversationRead(undefined, CONVERSATION, 0)).toBeUndefined();
  });

  it("updates the preview of the sent message", () => {
    const next = withConversationPreview(
      {
        ...page(),
        results: [
          conversation({
            lastMessage: {
              id: "m",
              body: "old",
              createdAt: at(1),
              eventType: "X",
              messageType: "USER",
              senderId: THEM,
            },
          }),
        ],
      },
      CONVERSATION,
      { body: "new", attachmentName: "f.pdf", at: at(9) },
    );
    expect(next?.results[0]).toMatchObject({
      lastMessage: { body: "new", eventType: null },
      lastAttachmentName: "f.pdf",
      lastMessageAt: at(9),
    });
    expect(
      withConversationPreview(undefined, CONVERSATION, {
        body: null,
        attachmentName: null,
        at: at(1),
      }),
    ).toBeUndefined();
  });
});

describe("sound and typing", () => {
  const isMine = (senderId: string | null) => senderId === ME;

  it("plays only for changed messages from someone else", () => {
    expect(
      shouldPlayMessageSound({ messagesChanged: true, senderId: THEM }, isMine),
    ).toBe(true);
    expect(
      shouldPlayMessageSound({ messagesChanged: true, senderId: null }, isMine),
    ).toBe(true);
    expect(
      shouldPlayMessageSound({ messagesChanged: true, senderId: ME }, isMine),
    ).toBe(false);
    expect(
      shouldPlayMessageSound(
        { messagesChanged: false, senderId: THEM },
        isMine,
      ),
    ).toBe(false);
  });

  it("shows typing only for another account", () => {
    expect(isCounterpartyTyping([THEM], ME)).toBe(true);
    expect(isCounterpartyTyping([ME], ME)).toBe(false);
    expect(isCounterpartyTyping([], ME)).toBe(false);
  });
});

describe("attachments and errors", () => {
  it("accepts the backend types up to 5 MB", () => {
    expect(
      validateAttachment({ type: "image/png", size: 5 * 1024 * 1024 }),
    ).toBe(null);
    expect(validateAttachment({ type: "image/gif", size: 10 })).toBe(
      "Use PDF, DOCX, PNG, JPG, or TXT files only.",
    );
    expect(
      validateAttachment({
        type: "application/pdf",
        size: 5 * 1024 * 1024 + 1,
      }),
    ).toBe("The maximum attachment size is 5 MB.");
  });

  it("formats sizes", () => {
    expect(formatFileSize(512)).toBe("0.5 KB");
    expect(formatFileSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });

  it("shows an ApiError message with its request id", () => {
    const error = new ApiError({
      status: 409,
      code: "CONFLICT",
      message: "Meeting already running.",
      requestId: "req-9",
    });
    expect(messageErrorMessage(error)).toBe(
      "Meeting already running. (reference req-9)",
    );
  });

  it("does not leak a server error or a raw exception", () => {
    const error = new ApiError({
      status: 500,
      code: "INTERNAL_ERROR",
      message: "stack at db.ts:1",
      requestId: "req-1",
    });
    expect(messageErrorMessage(error)).not.toContain("stack");
    expect(messageErrorMessage(new Error("boom"))).not.toContain("boom");
  });
});

describe("attachment copy", () => {
  it("derives the size message and hint from the byte limit", () => {
    const mb = MAX_ATTACHMENT_BYTES / (1024 * 1024);
    expect(ATTACHMENT_SIZE_MESSAGE).toBe(
      `The maximum attachment size is ${mb} MB.`,
    );
    expect(ATTACHMENT_HINT).toBe(
      `PDF, DOCX, PNG, JPG, or TXT · Maximum ${mb} MB`,
    );
  });
});
