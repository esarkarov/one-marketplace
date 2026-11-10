import { describe, expect, it } from "vitest";
import {
  createNotificationEnvelope,
  notificationEnvelopeSchema,
} from "./envelope.js";

const agencyId = "3f2b8c1e-9a4d-4e7f-8b21-5c6d7e8f9a0b";

describe("notification envelope", () => {
  it("builds a versioned envelope with a uuid and an ISO timestamp", () => {
    const envelope = createNotificationEnvelope({
      recipientId: "user_1",
      type: "PROPOSAL_RECEIVED",
      title: "Title",
      message: "Message",
    });

    expect(envelope.type).toBe("notifications.created");
    expect(envelope.version).toBe(1);
    expect(notificationEnvelopeSchema.safeParse(envelope).success).toBe(true);
    expect(new Date(envelope.occurredAt).toISOString()).toBe(
      envelope.occurredAt,
    );
  });

  it("generates a new id per envelope", () => {
    const input = { recipientId: "u", type: "T", title: "a", message: "b" };

    expect(createNotificationEnvelope(input).id).not.toBe(
      createNotificationEnvelope(input).id,
    );
  });

  it("uses a provided eventId as the envelope id and keeps it out of the payload", () => {
    const eventId = "0b5f6a52-3c1e-5d7a-8a41-9c2d3e4f5a6b";
    const envelope = createNotificationEnvelope({
      recipientId: "u",
      type: "T",
      title: "a",
      message: "b",
      eventId,
    });

    expect(envelope.id).toBe(eventId);
    expect(envelope.payload).not.toHaveProperty("eventId");
    expect(notificationEnvelopeSchema.safeParse(envelope).success).toBe(true);
  });

  it("accepts an agency target with link and metadata", () => {
    const envelope = createNotificationEnvelope({
      agencyId,
      type: "T",
      title: "a",
      message: "b",
      link: "/x",
      metadata: { contractId: "c" },
    });

    expect(notificationEnvelopeSchema.safeParse(envelope).success).toBe(true);
  });

  it.each([
    ["wrong version", { version: 2 }],
    ["wrong type", { type: "other" }],
    ["bad id", { id: "not-a-uuid" }],
    ["bad timestamp", { occurredAt: "yesterday" }],
    ["missing payload", { payload: undefined }],
    ["no target", { payload: { type: "T", title: "a", message: "b" } }],
    [
      "both targets",
      {
        payload: {
          recipientId: "u",
          agencyId,
          type: "T",
          title: "a",
          message: "b",
        },
      },
    ],
  ])("rejects %s", (_name, override) => {
    const valid = createNotificationEnvelope({
      recipientId: "u",
      type: "T",
      title: "a",
      message: "b",
    });

    expect(
      notificationEnvelopeSchema.safeParse({ ...valid, ...override }).success,
    ).toBe(false);
  });
});
