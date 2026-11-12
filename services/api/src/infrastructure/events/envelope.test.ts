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
    expect(envelope.version).toBe(2);
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

  const base = () =>
    createNotificationEnvelope({
      recipientId: "u",
      type: "T",
      title: "a",
      message: "b",
    });
  const withMetadata = (
    version: number,
    metadata?: Record<string, unknown>,
  ) => ({
    ...base(),
    version,
    payload: { ...base().payload, metadata },
  });
  const parsed = (value: unknown) =>
    notificationEnvelopeSchema.safeParse(value);

  it("converts a v1 amount to amountCents and emits the v2 shape", () => {
    const result = parsed(withMetadata(1, { amount: 19.99, a: 1 }));

    expect(result.success).toBe(true);
    expect(result.data?.version).toBe(2);
    expect(result.data?.payload.metadata).toEqual({ amountCents: 1999, a: 1 });
  });

  it("passes a v1 message without amount through", () => {
    const result = parsed(withMetadata(1, { a: 1 }));

    expect(result.success).toBe(true);
    expect(result.data?.payload.metadata).toEqual({ a: 1 });
  });

  it.each([
    ["three decimals", { amount: 1.005 }],
    ["non-numeric", { amount: "5" }],
    ["negative", { amount: -1 }],
  ])("rejects a v1 amount with %s", (_name, metadata) => {
    expect(parsed(withMetadata(1, metadata)).success).toBe(false);
  });

  it("accepts a v2 amountCents integer", () => {
    expect(parsed(withMetadata(2, { amountCents: 1999 })).success).toBe(true);
  });

  it.each([
    ["float amountCents", { amountCents: 19.99 }],
    ["negative amountCents", { amountCents: -1 }],
    ["amount key", { amount: 5 }],
    ["amount and amountCents", { amount: 5, amountCents: 500 }],
  ])("rejects a v2 message with %s", (_name, metadata) => {
    expect(parsed(withMetadata(2, metadata)).success).toBe(false);
  });

  it.each([
    ["wrong version", { version: 3 }],
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
