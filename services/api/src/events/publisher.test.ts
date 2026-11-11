import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  connected: vi.fn(),
  publish: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../config/rabbitmq.js", () => ({
  isRabbitEnabled: mocks.enabled,
  isRabbitConnected: mocks.connected,
  getRabbitPublishChannel: () => ({ publish: mocks.publish }),
}));

vi.mock("../config/logger.js", () => ({
  logger: { warn: mocks.warn, error: mocks.error },
}));

const { sendNotification } = await import("./publisher.js");

const input = {
  recipientId: "user_1",
  type: "PROPOSAL_RECEIVED",
  title: "Title",
  message: "Message",
};

const publishedBody = (call: number) =>
  JSON.parse((mocks.publish.mock.calls[call]![2] as Buffer).toString());

beforeEach(() => {
  vi.resetAllMocks();
  mocks.enabled.mockReturnValue(true);
  mocks.connected.mockReturnValue(true);
  mocks.publish.mockResolvedValue(true);
});

describe("sendNotification", () => {
  it("is a no-op without RabbitMQ", async () => {
    mocks.enabled.mockReturnValue(false);

    await expect(sendNotification(input)).resolves.toBe("disabled");
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("returns failed without publishing while disconnected", async () => {
    mocks.connected.mockReturnValue(false);

    await expect(sendNotification(input)).resolves.toBe("failed");

    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledTimes(1);
    const entry = mocks.warn.mock.calls[0]![0];
    expect(entry.eventName).toBe("queue.publish.skipped");
    expect(entry.attributes).toMatchObject({
      "messaging.system": "rabbitmq",
      reason: "disconnected",
    });
    expect(JSON.stringify(entry)).not.toMatch(/amqp|secret|error/i);
  });

  it("does not throw when the logger rejects while disconnected", async () => {
    mocks.connected.mockReturnValue(false);
    mocks.warn.mockRejectedValue(new Error("log sink down"));

    await expect(sendNotification(input)).resolves.toBe("failed");
  });

  it("does not throw when the logger rejects after a publish failure", async () => {
    mocks.publish.mockRejectedValue(new Error("nack"));
    mocks.error.mockRejectedValue(new Error("log sink down"));

    await expect(sendNotification(input)).resolves.toBe("failed");
  });

  it("publishes a persistent json envelope with the envelope id as message id", async () => {
    await expect(sendNotification(input)).resolves.toBe("published");

    expect(mocks.publish).toHaveBeenCalledTimes(1);
    const [exchange, routingKey, , options] = mocks.publish.mock.calls[0]!;
    const body = publishedBody(0);

    expect(exchange).toBe("notifications");
    expect(routingKey).toBe("notifications.created");
    expect(options).toMatchObject({
      persistent: true,
      deliveryMode: 2,
      contentType: "application/json",
      messageId: body.id,
    });
    expect(options.timeout).toBeGreaterThan(0);
    expect(body).toMatchObject({
      type: "notifications.created",
      version: 2,
      payload: input,
    });
  });

  it("publishes with a provided eventId as the message id", async () => {
    const eventId = "0b5f6a52-3c1e-5d7a-8a41-9c2d3e4f5a6b";

    await sendNotification({ ...input, eventId });

    const body = publishedBody(0);
    expect(body.id).toBe(eventId);
    expect(body.payload).toEqual(input);
    expect(mocks.publish.mock.calls[0]![3].messageId).toBe(eventId);
  });

  it("retries once with the same envelope", async () => {
    mocks.publish.mockRejectedValueOnce(new Error("nack"));

    await expect(sendNotification(input)).resolves.toBe("published");

    expect(mocks.publish).toHaveBeenCalledTimes(2);
    expect(publishedBody(1).id).toBe(publishedBody(0).id);
    expect(mocks.publish.mock.calls[1]![3].messageId).toBe(publishedBody(0).id);
  });

  it("never throws when both attempts fail", async () => {
    mocks.publish.mockRejectedValue(
      new Error("connect amqp://user:secret@host:5672 refused"),
    );

    await expect(sendNotification(input)).resolves.toBe("failed");
    expect(mocks.publish).toHaveBeenCalledTimes(2);
  });
});
