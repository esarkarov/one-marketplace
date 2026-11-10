import amqp, {
  type ChannelWrapper,
  type AmqpConnectionManager,
} from "amqp-connection-manager";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { assertTopology, type TopologyOptions } from "../events/topology.js";
import { errorLogAttributes } from "../utils/sanitize-log.js";

let connection: AmqpConnectionManager | undefined;
let publishChannel: ChannelWrapper | undefined;
let consumerChannel: ChannelWrapper | undefined;

export const isRabbitEnabled = (): boolean => Boolean(env.rabbitmqUrl);

export const createRabbitConnection = (url: string): AmqpConnectionManager => {
  const manager = amqp.connect([url], { heartbeatIntervalInSeconds: 10 });

  manager.on("disconnect", ({ err }) => {
    void logger.warn({
      message: "RabbitMQ connection lost",
      eventName: "queue.connection.lost",
      attributes: {
        "messaging.system": "rabbitmq",
        ...errorLogAttributes(err),
      },
    });
  });
  manager.on("connectFailed", ({ err }) => {
    void logger.warn({
      message: "RabbitMQ connection failed",
      eventName: "queue.connection.failed",
      attributes: {
        "messaging.system": "rabbitmq",
        ...errorLogAttributes(err),
      },
    });
  });

  return manager;
};

export const createRabbitChannel = (
  manager: AmqpConnectionManager,
  name: string,
  topology: TopologyOptions = {},
): ChannelWrapper => {
  const channel = manager.createChannel({
    name,
    confirm: true,
    setup: (rawChannel: Parameters<typeof assertTopology>[0]) =>
      assertTopology(rawChannel, topology),
  });

  channel.on("error", (error) => {
    void logger.warn({
      message: "RabbitMQ channel error",
      eventName: "queue.channel.error",
      attributes: {
        "messaging.system": "rabbitmq",
        "queue.channel": name,
        ...errorLogAttributes(error),
      },
    });
  });

  return channel;
};

const getConnection = (): AmqpConnectionManager => {
  if (!env.rabbitmqUrl) {
    throw new Error("RabbitMQ is not configured.");
  }

  return (connection ??= createRabbitConnection(env.rabbitmqUrl));
};

export const getRabbitPublishChannel = (): ChannelWrapper =>
  (publishChannel ??= createRabbitChannel(
    getConnection(),
    "notifications-publisher",
  ));

export const getRabbitConsumerChannel = (): ChannelWrapper =>
  (consumerChannel ??= createRabbitChannel(
    getConnection(),
    "notifications-consumer",
  ));

export const isRabbitConnected = (): boolean =>
  connection?.isConnected() ?? false;

export const getRabbitStatus = async (): Promise<{
  ok: boolean;
  latencyMs?: number;
}> => ({ ok: isRabbitEnabled() && isRabbitConnected() });

export const closeRabbit = async (timeoutMs: number): Promise<void> => {
  const current = connection;
  const channels = [publishChannel, consumerChannel];
  connection = undefined;
  publishChannel = undefined;
  consumerChannel = undefined;
  if (!current) return;

  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });

  try {
    await Promise.race([
      (async () => {
        await Promise.allSettled(channels.map((channel) => channel?.close()));
        await current.close();
      })(),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
};
