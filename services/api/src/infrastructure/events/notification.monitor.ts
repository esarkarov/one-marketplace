import type { ChannelWrapper } from "amqp-connection-manager";
import { logger } from "@/config/logger.js";
import {
  DEAD_LETTER_CHECK_FAILURE_LOG_INTERVAL_MS,
  DEAD_LETTER_CHECK_INTERVAL_MS,
  DEAD_LETTER_NONEMPTY_LOG_INTERVAL_MS,
  DEAD_LETTER_STOP_TIMEOUT_MS,
} from "@/infrastructure/constants/index.js";
import { errorLogAttributes } from "@/shared/logging/sanitize-log.js";
import { topologyNames } from "./notification.topology.js";
import {
  getRabbitMonitorChannel,
  resetRabbitMonitorChannel,
} from "./rabbitmq.client.js";

export interface DeadLetterMonitorOptions {
  getChannel: () => Pick<ChannelWrapper, "checkQueue">;
  resetChannel: () => Promise<void>;
  prefix?: string;
  intervalMs?: number;
  failureLogIntervalMs?: number;
  nonEmptyLogIntervalMs?: number;
  now?: () => number;
}

export const createDeadLetterMonitor = (options: DeadLetterMonitorOptions) => {
  const queue = topologyNames(options.prefix).deadLetterQueue;
  const intervalMs = options.intervalMs ?? DEAD_LETTER_CHECK_INTERVAL_MS;
  const failureLogIntervalMs =
    options.failureLogIntervalMs ?? DEAD_LETTER_CHECK_FAILURE_LOG_INTERVAL_MS;
  const nonEmptyLogIntervalMs =
    options.nonEmptyLogIntervalMs ?? DEAD_LETTER_NONEMPTY_LOG_INTERVAL_MS;
  const now = options.now ?? Date.now;
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  let inFlight: Promise<void> | undefined;
  let lastFailureLoggedAt: number | undefined;
  let lastLoggedDepth = 0;
  let lastDepthLoggedAt: number | undefined;

  const warn = async (
    message: string,
    eventName: string,
    attributes: Record<string, unknown>,
  ) => {
    try {
      await logger.warn({
        message,
        eventName,
        attributes: {
          "messaging.system": "rabbitmq",
          "messaging.destination.name": queue,
          ...attributes,
        },
      });
    } catch {}
  };

  const reportDepth = async (depth: number): Promise<void> => {
    if (depth === 0) {
      lastLoggedDepth = 0;
      lastDepthLoggedAt = undefined;
      return;
    }
    const at = now();
    if (
      depth === lastLoggedDepth &&
      lastDepthLoggedAt !== undefined &&
      at - lastDepthLoggedAt < nonEmptyLogIntervalMs
    ) {
      return;
    }
    lastLoggedDepth = depth;
    lastDepthLoggedAt = at;
    await warn("Dead-letter queue is not empty", "queue.dead_letter.nonempty", {
      depth,
    });
  };

  const reportFailure = async (error: unknown): Promise<void> => {
    const at = now();
    if (
      lastFailureLoggedAt !== undefined &&
      at - lastFailureLoggedAt < failureLogIntervalMs
    ) {
      return;
    }
    lastFailureLoggedAt = at;
    await warn(
      "Dead-letter queue check failed",
      "queue.dead_letter.check_failed",
      errorLogAttributes(error),
    );
  };

  const run = async (): Promise<void> => {
    try {
      const { messageCount } = await options.getChannel().checkQueue(queue);
      await reportDepth(messageCount);
    } catch (error) {
      await reportFailure(error);
      if (!stopped) await options.resetChannel().catch(() => undefined);
    }
  };

  const check = (): Promise<void> => {
    if (stopped || inFlight) return Promise.resolve();
    const current = run().finally(() => {
      if (inFlight === current) inFlight = undefined;
    });
    inFlight = current;
    return current;
  };

  return {
    check,
    start: () => {
      if (timer || stopped) return;
      timer = setInterval(() => void check(), intervalMs);
      timer.unref();
    },
    stop: async (timeoutMs = DEAD_LETTER_STOP_TIMEOUT_MS): Promise<void> => {
      stopped = true;
      clearInterval(timer);
      timer = undefined;
      const pending = inFlight;
      if (!pending) return;
      let deadline: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          pending.catch(() => undefined),
          new Promise<void>((resolve) => {
            deadline = setTimeout(resolve, timeoutMs);
          }),
        ]);
      } finally {
        clearTimeout(deadline);
      }
    },
  };
};

let monitor: ReturnType<typeof createDeadLetterMonitor> | undefined;

export const startDeadLetterMonitor = (): void => {
  if (monitor) return;
  monitor = createDeadLetterMonitor({
    getChannel: getRabbitMonitorChannel,
    resetChannel: resetRabbitMonitorChannel,
  });
  monitor.start();
};

export const stopDeadLetterMonitor = async (): Promise<void> => {
  const current = monitor;
  monitor = undefined;
  await current?.stop();
};
