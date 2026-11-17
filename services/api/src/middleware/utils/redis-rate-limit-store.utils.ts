import { MemoryStore } from "express-rate-limit";
import type { ClientRateLimitInfo, Options, Store } from "express-rate-limit";
import { logger } from "../../config/logger.js";
import { redis } from "../../infrastructure/cache/redis.client.js";
import { errorLogAttributes } from "../../shared/logging/sanitize-log.js";
import {
  RATE_LIMIT_DECREMENT_SCRIPT,
  RATE_LIMIT_INCREMENT_SCRIPT,
  RATE_LIMIT_KEY_PREFIX,
  RATE_LIMIT_STORE_TIMEOUT_MS,
  RATE_LIMIT_STORE_WARN_INTERVAL_MS,
} from "../constants/rate-limit.constants.js";

let lastWarnAt: number | undefined;

const warnStoreError = (error: unknown) => {
  const now = Date.now();
  if (
    lastWarnAt !== undefined &&
    now - lastWarnAt < RATE_LIMIT_STORE_WARN_INTERVAL_MS
  ) {
    return;
  }

  lastWarnAt = now;
  void logger.warn({
    message: "Rate limit store failed. Falling back to in-memory limiting.",
    eventName: "rate_limit.store.error",
    attributes: errorLogAttributes(error),
  });
};

const withTimeout = async <T>(operation: Promise<T>): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error("Rate limit store timed out.")),
      RATE_LIMIT_STORE_TIMEOUT_MS,
    );
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    clearTimeout(timer);
  }
};

const parseIncrement = (reply: unknown, windowMs: number) => {
  if (
    !Array.isArray(reply) ||
    typeof reply[0] !== "number" ||
    typeof reply[1] !== "number"
  ) {
    throw new Error("Unexpected rate limit script reply.");
  }

  const ttl = reply[1] > 0 ? reply[1] : windowMs;
  return { totalHits: reply[0], resetTime: new Date(Date.now() + ttl) };
};

export class RedisRateLimitStore implements Store {
  localKeys = false;
  prefix: string;
  private windowMs = 0;
  private readonly fallback = new MemoryStore();

  constructor(name: string) {
    this.prefix = `${RATE_LIMIT_KEY_PREFIX}:${name}:`;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
    this.fallback.init(options);
  }

  private keyOf(key: string) {
    return `${this.prefix}${key}`;
  }

  private ensureReady() {
    if (!redis.isReady) {
      throw new Error("Redis client is not ready.");
    }
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    try {
      this.ensureReady();
      const reply = await withTimeout(
        redis.eval(RATE_LIMIT_INCREMENT_SCRIPT, {
          keys: [this.keyOf(key)],
          arguments: [String(this.windowMs)],
        }),
      );
      return parseIncrement(reply, this.windowMs);
    } catch (error) {
      warnStoreError(error);
      return this.fallback.increment(key);
    }
  }

  async decrement(key: string): Promise<void> {
    try {
      this.ensureReady();
      await withTimeout(
        redis.eval(RATE_LIMIT_DECREMENT_SCRIPT, { keys: [this.keyOf(key)] }),
      );
    } catch (error) {
      warnStoreError(error);
    }
    await this.fallback.decrement(key);
  }

  async resetKey(key: string): Promise<void> {
    try {
      this.ensureReady();
      await withTimeout(redis.del(this.keyOf(key)));
    } catch (error) {
      warnStoreError(error);
    }
    await this.fallback.resetKey(key);
  }
}

export const createRedisRateLimitStore = (name: string) =>
  new RedisRateLimitStore(name);

export const resetRateLimitStoreWarning = () => {
  lastWarnAt = undefined;
};
