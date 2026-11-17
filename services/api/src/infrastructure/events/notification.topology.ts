import {
  DEFAULT_DELIVERY_LIMIT,
  NOTIFICATIONS_CREATED_ROUTING_KEY,
} from "../constants/index.js";
import type { TopologyChannel, TopologyOptions } from "../types/index.js";

export const topologyNames = (prefix = "") => ({
  exchange: `${prefix}notifications`,
  storageQueue: `${prefix}notifications.storage`,
  deadLetterExchange: `${prefix}notifications.dlx`,
  deadLetterQueue: `${prefix}notifications.dead`,
});

export const assertTopology = async (
  channel: TopologyChannel,
  { prefix = "", deliveryLimit = DEFAULT_DELIVERY_LIMIT }: TopologyOptions = {},
): Promise<void> => {
  const names = topologyNames(prefix);

  await channel.assertExchange(names.deadLetterExchange, "fanout", {
    durable: true,
  });
  await channel.assertQueue(names.deadLetterQueue, { durable: true });
  await channel.bindQueue(names.deadLetterQueue, names.deadLetterExchange, "");

  await channel.assertExchange(names.exchange, "topic", { durable: true });
  await channel.assertQueue(names.storageQueue, {
    durable: true,
    arguments: {
      "x-queue-type": "quorum",
      "x-delivery-limit": deliveryLimit,
      "x-dead-letter-exchange": names.deadLetterExchange,
      "x-dead-letter-strategy": "at-least-once",
      "x-overflow": "reject-publish",
    },
  });
  await channel.bindQueue(
    names.storageQueue,
    names.exchange,
    NOTIFICATIONS_CREATED_ROUTING_KEY,
  );
};
