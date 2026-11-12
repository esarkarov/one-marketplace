import pino from "pino";
import type { DestinationStream } from "pino";
import { env } from "./env.js";
import { sanitizeForLog } from "../shared/utils/sanitize-log.js";

type AttributeValue = string | number | boolean | null;

export type LogPayload = {
  message: string;
  eventName?: string;
  attributes?: Record<string, AttributeValue | AttributeValue[]>;
};

type LogMethod = (payload: LogPayload) => Promise<void>;

export type AppLogger = {
  trace: LogMethod;
  debug: LogMethod;
  info: LogMethod;
  warn: LogMethod;
  warning: LogMethod;
  error: LogMethod;
  fatal: LogMethod;
};

const sanitizeValue = (value: unknown): unknown => {
  if (typeof value === "string") return sanitizeForLog(value);
  if (Array.isArray(value)) return value.map(sanitizeValue);
  return value;
};

export const createRootLogger = (
  destination?: DestinationStream,
  level: string = env.nodeEnv === "test" ? "silent" : "info",
) => {
  const options: pino.LoggerOptions = {
    level,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        'res.headers["set-cookie"]',
      ],
      censor: "[Redacted]",
    },
  };

  return destination ? pino(options, destination) : pino(options);
};

export const createAppLogger = (base: pino.Logger): AppLogger => {
  const write =
    (
      level: "trace" | "debug" | "info" | "warn" | "error" | "fatal",
    ): LogMethod =>
    ({ message, eventName, attributes }) => {
      const safeAttributes = attributes
        ? Object.fromEntries(
            Object.entries(attributes).map(([key, value]) => [
              key,
              sanitizeValue(value),
            ]),
          )
        : undefined;
      base[level](
        { eventName, attributes: safeAttributes },
        sanitizeForLog(message),
      );
      return Promise.resolve();
    };

  return {
    trace: write("trace"),
    debug: write("debug"),
    info: write("info"),
    warn: write("warn"),
    warning: write("warn"),
    error: write("error"),
    fatal: write("fatal"),
  };
};

export const rootLogger = createRootLogger();

export const logger: AppLogger = createAppLogger(rootLogger);
