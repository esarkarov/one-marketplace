export const SSE_RECONNECT_DELAY_MS = 1_000;
export const SSE_SHUTDOWN_FRAME = `retry: ${SSE_RECONNECT_DELAY_MS}\nevent: shutdown\ndata: {}\n\n`;
export const SSE_UNAVAILABLE_RETRY_AFTER_SECONDS = 1;
export const SSE_UNAVAILABLE_MESSAGE = "Server is shutting down.";
