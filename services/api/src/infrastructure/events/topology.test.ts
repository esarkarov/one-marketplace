import { describe, expect, it, vi } from "vitest";
import { assertTopology, topologyNames } from "./topology.js";

const channel = () => ({
  assertExchange: vi.fn().mockResolvedValue({}),
  assertQueue: vi.fn().mockResolvedValue({}),
  bindQueue: vi.fn().mockResolvedValue({}),
});

describe("assertTopology", () => {
  it("declares the durable quorum queue with dead-lettering", async () => {
    const ch = channel();
    await assertTopology(ch);

    expect(ch.assertExchange).toHaveBeenCalledWith("notifications", "topic", {
      durable: true,
    });
    expect(ch.assertExchange).toHaveBeenCalledWith(
      "notifications.dlx",
      "fanout",
      { durable: true },
    );
    expect(ch.assertQueue).toHaveBeenCalledWith("notifications.storage", {
      durable: true,
      arguments: {
        "x-queue-type": "quorum",
        "x-delivery-limit": 5,
        "x-dead-letter-exchange": "notifications.dlx",
        "x-dead-letter-strategy": "at-least-once",
        "x-overflow": "reject-publish",
      },
    });
    expect(ch.assertQueue).toHaveBeenCalledWith("notifications.dead", {
      durable: true,
    });
    expect(ch.bindQueue).toHaveBeenCalledWith(
      "notifications.storage",
      "notifications",
      "notifications.created",
    );
    expect(ch.bindQueue).toHaveBeenCalledWith(
      "notifications.dead",
      "notifications.dlx",
      "",
    );
  });

  it("applies the prefix and delivery limit", async () => {
    const ch = channel();
    await assertTopology(ch, { prefix: "t1.", deliveryLimit: 2 });
    const names = topologyNames("t1.");

    expect(names.storageQueue).toBe("t1.notifications.storage");
    expect(ch.assertExchange).toHaveBeenCalledWith(
      "t1.notifications",
      "topic",
      { durable: true },
    );
    expect(ch.assertQueue).toHaveBeenCalledWith(
      "t1.notifications.storage",
      expect.objectContaining({
        arguments: expect.objectContaining({
          "x-delivery-limit": 2,
          "x-dead-letter-exchange": "t1.notifications.dlx",
        }),
      }),
    );
    expect(ch.bindQueue).toHaveBeenCalledWith(
      "t1.notifications.dead",
      "t1.notifications.dlx",
      "",
    );
  });
});
