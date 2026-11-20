import type { Notification } from "../notifications";

export interface RecordedCall {
  method: string;
  path: string;
  search: URLSearchParams;
  headers: Headers;
}

export interface FakeStream {
  signal: AbortSignal | undefined;
  headers: Headers;
  push: (text: string) => void;
  end: () => void;
}

export const sseResponse = (signal: AbortSignal | undefined) => {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  signal?.addEventListener("abort", () => {
    try {
      controller.error(new DOMException("Aborted", "AbortError"));
    } catch {
      return;
    }
  });
  return {
    response: new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }),
    push: (text: string) => controller.enqueue(encoder.encode(text)),
    end: () => controller.close(),
  };
};

export const ok = (data: unknown) =>
  new Response(JSON.stringify({ success: true, message: "ok", data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

export const failure = (status: number) =>
  new Response(
    JSON.stringify({
      success: false,
      message: "failed",
      code: "INTERNAL_ERROR",
      requestId: "r1",
    }),
    { status, headers: { "content-type": "application/json" } },
  );

type Handler = (call: RecordedCall) => Response | Promise<Response>;

export class FakeServer {
  calls: RecordedCall[] = [];
  streams: FakeStream[] = [];
  routes = new Map<string, Handler>();

  on(method: string, path: string, handler: Handler) {
    this.routes.set(`${method} ${path}`, handler);
  }

  count(method: string, path: string) {
    return this.calls.filter(
      (call) => call.method === method && call.path === path,
    ).length;
  }

  fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const request = input instanceof Request ? input : undefined;
    const url = new URL(request ? request.url : String(input));
    const call: RecordedCall = {
      method: (request?.method ?? init?.method ?? "GET").toUpperCase(),
      path: url.pathname,
      search: url.searchParams,
      headers: new Headers(request?.headers ?? init?.headers),
    };
    this.calls.push(call);

    if (call.method === "GET" && call.path === "/api/v1/notifications/stream") {
      const handler = this.routes.get("GET /api/v1/notifications/stream");
      if (handler) return handler(call);
      const stream = sseResponse(init?.signal ?? request?.signal ?? undefined);
      this.streams.push({
        signal: init?.signal ?? undefined,
        headers: call.headers,
        push: stream.push,
        end: stream.end,
      });
      return stream.response;
    }

    const handler = this.routes.get(`${call.method} ${call.path}`);
    if (!handler) return failure(404);
    return handler(call);
  };
}

export const makeNotification = (
  id: string,
  overrides: Partial<Notification> = {},
): Notification => ({
  id,
  eventId: `event-${id}`,
  recipientId: "00000000-0000-4000-8000-000000000001",
  agencyId: null,
  type: "MILESTONE_FUNDED",
  title: `Title ${id}`,
  message: `Message ${id}`,
  link: null,
  metadata: null,
  isRead: false,
  readAt: null,
  createdAt: "2026-11-20T10:00:00.000Z",
  ...overrides,
});

export const frame = (notification: Notification) =>
  `event: notification\ndata: ${JSON.stringify(notification)}\n\n`;

export const flush = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));
