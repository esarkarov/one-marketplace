import type { Response } from "express";
import { ApiError } from "@/shared/errors/api-error.js";
import {
  SSE_SHUTDOWN_FRAME,
  SSE_UNAVAILABLE_MESSAGE,
  SSE_UNAVAILABLE_RETRY_AFTER_SECONDS,
} from "@/middleware/constants/sse-streams.constants.js";

const openStreams = new Set<Response>();
let closing = false;

export const registerSseStream = (response: Response): (() => void) => {
  openStreams.add(response);
  const unregister = () => {
    openStreams.delete(response);
  };
  response.once("close", unregister);
  response.once("finish", unregister);
  return unregister;
};

export const openSseStreamCount = (): number => openStreams.size;

export const closeAllSseStreams = (): void => {
  closing = true;
  const streams = [...openStreams];
  openStreams.clear();
  for (const stream of streams) {
    try {
      stream.write(SSE_SHUTDOWN_FRAME);
      stream.end();
    } catch {
      continue;
    }
  }
};

export const assertSseAvailable = (response: Response): void => {
  if (!closing) return;
  response.set("Retry-After", String(SSE_UNAVAILABLE_RETRY_AFTER_SECONDS));
  throw new ApiError(503, SSE_UNAVAILABLE_MESSAGE);
};
