import { isSpanContextValid, trace } from "@opentelemetry/api";
import pino from "pino";
import type { DestinationStream } from "pino";
import { env } from "./env.js";
import { sanitizeForLog } from "@/shared/logging/sanitize-log.js";

type AttributeValue = string | number | boolean | null;

interface LogPayload {
  message: string;
  eventName?: string;
  attributes?: Record<string, AttributeValue | AttributeValue[]>;
}

type LogMethod = (payload: LogPayload) => Promise<void>;

type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface LogEvent {
  eventName: string;
  level: LogLevel;
}

export type LogEventListener = (event: LogEvent) => void;

let logEventListener: LogEventListener | null = null;

export const registerLogEventListener = (
  listener: LogEventListener | null,
): void => {
  logEventListener = listener;
};

const notifyLogEvent = (eventName: string | undefined, level: LogLevel) => {
  if (!logEventListener || !eventName) return;
  try {
    logEventListener({ eventName, level });
  } catch {
    return;
  }
};

export const traceContextMixin = (): Record<string, string> => {
  const context = trace.getActiveSpan()?.spanContext();
  if (!context || !isSpanContextValid(context)) return {};
  return { trace_id: context.traceId, span_id: context.spanId };
};

export interface AppLogger {
  trace: LogMethod;
  debug: LogMethod;
  info: LogMethod;
  warn: LogMethod;
  warning: LogMethod;
  error: LogMethod;
  fatal: LogMethod;
}

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
    mixin: traceContextMixin,
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
    (level: LogLevel): LogMethod =>
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
      notifyLogEvent(eventName, level);
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
