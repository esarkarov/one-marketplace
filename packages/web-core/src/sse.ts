export interface SseEvent {
  event: string;
  data: string;
  id?: string;
}

export interface ParsedChunks {
  events: SseEvent[];
  remainder: string;
}

const LINE_BREAK = /\r\n|\n|\r/;

/**
 * Incremental SSE parser. Pass each decoded text chunk and the `remainder`
 * returned by the previous call. Handles frames split anywhere (including a
 * CRLF split between chunks), CRLF/LF/CR, multi-line `data:`, `event:` and
 * `id:`, and skips comment lines (":" heartbeats). A frame whose data is empty
 * is not dispatched (WHATWG rule).
 */
export const parseSseChunks = (chunk: string, remainder = ""): ParsedChunks => {
  let text = remainder + chunk;
  const heldCarriageReturn = text.endsWith("\r");
  if (heldCarriageReturn) text = text.slice(0, -1);

  const parts = text.split(LINE_BREAK);
  const trailing = parts.pop() ?? "";
  const events: SseEvent[] = [];

  let pending: string[] = [];
  let eventName = "";
  let dataLines: string[] = [];
  let id: string | undefined;

  const reset = () => {
    pending = [];
    eventName = "";
    dataLines = [];
    id = undefined;
  };

  for (const line of parts) {
    if (line === "") {
      if (dataLines.length > 0) {
        const data = dataLines.join("\n");
        if (data !== "") {
          events.push({
            event: eventName || "message",
            data,
            ...(id === undefined ? {} : { id }),
          });
        }
      }
      reset();
      continue;
    }

    pending.push(line);
    if (line.startsWith(":")) continue;

    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "event") eventName = value;
    else if (field === "data") dataLines.push(value);
    else if (field === "id") id = value;
  }

  const carried = pending.map((line) => `${line}\n`).join("");
  return {
    events,
    remainder: carried + trailing + (heldCarriageReturn ? "\r" : ""),
  };
};

export type StreamStatus = "connecting" | "open" | "closed" | "error";

export interface StreamStatusInfo {
  httpStatus?: number;
}

export interface BackoffOptions {
  initialMs?: number;
  maxMs?: number;
  resetAfterMs?: number;
  random?: () => number;
}

export interface NotificationStreamOptions {
  baseUrl: string;
  role: string;
  scope?: string | undefined;
  getToken: () => Promise<string | null>;
  fetch?: typeof fetch;
  onEvent: (event: SseEvent) => void;
  onStatus?: (status: StreamStatus, info?: StreamStatusInfo) => void;
  onConnected?: () => void;
  backoff?: BackoffOptions;
}

export interface NotificationStream {
  start: () => void;
  stop: () => void;
}

const streamUrl = (baseUrl: string, role: string, scope?: string): string => {
  const origin = baseUrl.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
  const query = new URLSearchParams({ role });
  if (scope) query.set("scope", scope);
  return `${origin}/api/v1/notifications/stream?${query.toString()}`;
};

export const nextBackoffMs = (
  attempt: number,
  { initialMs = 1000, maxMs = 30_000, random = Math.random }: BackoffOptions,
): number => {
  const ceiling = Math.min(maxMs, initialMs * 2 ** attempt);
  return Math.round(ceiling * (0.5 + random() * 0.5));
};

export const createNotificationStream = (
  options: NotificationStreamOptions,
): NotificationStream => {
  const backoff = options.backoff ?? {};
  const resetAfterMs = backoff.resetAfterMs ?? 10_000;
  const doFetch: typeof fetch =
    options.fetch ?? ((...args) => globalThis.fetch(...args));

  let generation = 0;
  let active = false;
  let controller: AbortController | undefined;
  let wake: (() => void) | undefined;

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        wake = undefined;
        resolve();
      }, ms);
      wake = () => {
        clearTimeout(timer);
        wake = undefined;
        resolve();
      };
    });

  const halt = () => {
    active = false;
    generation += 1;
  };

  const run = async (mine: number) => {
    const current = () => mine === generation;
    const status = (value: StreamStatus, info?: StreamStatusInfo) => {
      if (current()) options.onStatus?.(value, info);
    };

    const readBody = async (body: ReadableStream<Uint8Array>) => {
      const reader = body.getReader();
      const decoder = new TextDecoder();
      const signal = controller?.signal;
      const cancel = () => void reader.cancel().catch(() => undefined);
      signal?.addEventListener("abort", cancel, { once: true });
      let remainder = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const parsed = parseSseChunks(
            decoder.decode(value, { stream: true }),
            remainder,
          );
          remainder = parsed.remainder;
          for (const event of parsed.events) {
            if (!current()) return;
            options.onEvent(event);
          }
        }
      } finally {
        signal?.removeEventListener("abort", cancel);
      }
    };

    let attempt = 0;
    while (current()) {
      let openedAt: number | undefined;
      status("connecting");
      const attemptController = new AbortController();
      controller = attemptController;
      try {
        const token = await options.getToken();
        if (!current()) break;
        if (!token) {
          status("error", { httpStatus: 401 });
          halt();
          break;
        }

        const response = await doFetch(
          streamUrl(options.baseUrl, options.role, options.scope),
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "text/event-stream",
            },
            cache: "no-store",
            signal: attemptController.signal,
          },
        );

        if (!current()) break;
        if (response.status === 401 || response.status === 403) {
          status("error", { httpStatus: response.status });
          halt();
          break;
        }
        if (!response.ok || !response.body) {
          throw new Error(`Stream request failed with ${response.status}`);
        }

        openedAt = Date.now();
        status("open");
        options.onConnected?.();
        await readBody(response.body);
        status("closed");
      } catch {
        status("error");
      }

      if (!current()) break;
      if (openedAt !== undefined && Date.now() - openedAt >= resetAfterMs) {
        attempt = 0;
      }
      const delay = nextBackoffMs(attempt, backoff);
      attempt += 1;
      await sleep(delay);
    }
  };

  return {
    start: () => {
      if (active) return;
      active = true;
      generation += 1;
      void run(generation);
    },
    stop: () => {
      const wasActive = active;
      halt();
      controller?.abort();
      wake?.();
      if (wasActive) options.onStatus?.("closed");
    },
  };
};
