import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock("../../../config/logger.js", () => ({
  logger: { error: mocks.error },
}));

const { toConversationResponse, toMessageResponse, toPublicSenderId } =
  await import("../utils/messaging.mappers.js");

const CLERK_ID = "user_2clerkSender";
const PUBLIC_ID = "7d6f6c0e-3c0a-4b53-8f33-0b2f6f1a9c11";
const NOW = new Date("2026-01-01T00:00:00.000Z");

const message = (senderAccountId: string | null, senderId: string | null) => ({
  id: "m1",
  conversationId: "c1",
  senderId,
  senderAccountId,
  messageType: "USER",
  body: "hi",
  eventType: null,
  eventPayload: null,
  replyToMessageId: null,
  createdAt: NOW,
});

const internalError = expect.objectContaining({
  statusCode: 500,
  code: "INTERNAL_ERROR",
});

beforeEach(() => {
  mocks.error.mockReset();
  mocks.error.mockResolvedValue(undefined);
});

describe("messaging mappers", () => {
  it("returns the accounts id and never the Clerk id for a sender", () => {
    const response = toMessageResponse(
      message(PUBLIC_ID, CLERK_ID),
      [],
      undefined,
      "messaging_get_by_conversation_id_messages",
    );
    expect(response.senderId).toBe(PUBLIC_ID);
    expect(JSON.stringify(response)).not.toContain(CLERK_ID);
  });

  it("keeps a null sender for system events", () => {
    expect(
      toPublicSenderId({ senderId: null, senderAccountId: null }, "op", "m1"),
    ).toBeNull();
  });

  it("answers a coded 500 when the sender cannot be resolved", () => {
    expect(() =>
      toMessageResponse(message(null, CLERK_ID), [], undefined, "op"),
    ).toThrow(internalError);
    expect(mocks.error).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: { operation: "op", "row.id": "m1" },
      }),
    );
  });

  it("answers a coded 500 when a reply sender cannot be resolved", () => {
    expect(() =>
      toMessageResponse(
        message(PUBLIC_ID, CLERK_ID),
        [],
        {
          id: "r1",
          senderId: CLERK_ID,
          senderAccountId: null,
          messageType: "USER",
          body: null,
          eventType: null,
        },
        "op",
      ),
    ).toThrow(internalError);
  });

  const conversation = (
    lastMessageSenderAccountId: string | null,
    startedByPublicId: string | null,
  ) =>
    toConversationResponse(
      {
        id: "c1",
        jobId: null,
        proposalId: null,
        lastMessageAt: NOW,
        updatedAt: NOW,
        unreadCount: 0,
        lastMessageSenderAccountId,
        lastMessage: {
          id: "m1",
          senderId: CLERK_ID,
          messageType: "USER",
          body: "hi",
          eventType: null,
          createdAt: NOW,
        },
        lastAttachmentName: null,
        jobTitle: null,
        contractId: null,
        contractStatus: null,
      },
      [],
      {
        conversationId: "c1",
        id: "mt1",
        joinUrl: "https://daily.example.test/r",
        startedAt: NOW,
        startedByPublicId,
      },
      "messaging_get",
    );

  it("maps the last message sender and the meeting starter to uuids", () => {
    const response = conversation(PUBLIC_ID, PUBLIC_ID);
    expect(response.lastMessage?.senderId).toBe(PUBLIC_ID);
    expect(response.activeMeeting?.startedByAccountId).toBe(PUBLIC_ID);
    expect(JSON.stringify(response)).not.toContain(CLERK_ID);
  });

  it("answers a coded 500 when the last message sender is unresolved", () => {
    expect(() => conversation(null, PUBLIC_ID)).toThrow(internalError);
  });

  it("answers a coded 500 when the meeting starter is unresolved", () => {
    expect(() => conversation(PUBLIC_ID, null)).toThrow(internalError);
  });
});
