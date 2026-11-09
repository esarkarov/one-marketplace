import { createLogger } from "@oneminutelogs/express";
import { env } from "./env.js";

type Logger = ReturnType<typeof createLogger>;
type Payload = Parameters<Logger["send"]>[0];
type LevelPayload = Omit<Payload, "level">;

const consoleMethod = {
  trace: "debug",
  debug: "debug",
  info: "info",
  warn: "warn",
  error: "error",
  fatal: "error",
} as const;

const unavailable = () =>
  new Error("OneMinuteLogs is not configured (ONE_MINUTE_LOGS_API_KEY).");

const send = async ({
  level = "info",
  message,
  eventName,
  attributes,
}: Payload) => {
  console[consoleMethod[level]](`[${level}] ${message}`, {
    eventName,
    ...attributes,
  });
};

const consoleLogger: Logger = {
  send,
  trace: (payload: LevelPayload) => send({ ...payload, level: "trace" }),
  debug: (payload: LevelPayload) => send({ ...payload, level: "debug" }),
  info: (payload: LevelPayload) => send({ ...payload, level: "info" }),
  warn: (payload: LevelPayload) => send({ ...payload, level: "warn" }),
  warning: (payload: LevelPayload) => send({ ...payload, level: "warn" }),
  error: (payload: LevelPayload) => send({ ...payload, level: "error" }),
  fatal: (payload: LevelPayload) => send({ ...payload, level: "fatal" }),
  verifyWebhook: () => Promise.reject(unavailable()),
  get: () => Promise.reject(unavailable()),
  stream: () => {
    throw unavailable();
  },
};

export const logger: Logger = env.oneMinuteLogsApiKey
  ? createLogger({
      apiKey: env.oneMinuteLogsApiKey,
      projectName: "OneMarketPlace",
      environment: env.nodeEnv,
    })
  : consoleLogger;
