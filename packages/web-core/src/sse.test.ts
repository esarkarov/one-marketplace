import { describe, expect, it, vi } from "vitest";
import {
  createNotificationStream,
  nextBackoffMs,
  parseSseChunks,
  type StreamStatus,
} from "./sse";
import { sseResponse } from "./test/fake-server";

describe("parseSseChunks", () => {
  it("parses a complete frame", () => {
    const { events, remainder } = parseSseChunks(
      'event: notification\ndata: {"a":1}\n\n',
    );
    expect(events).toEqual([{ event: "notification", data: '{"a":1}' }]);
    expect(remainder).toBe("");
  });

  it("reassembles a frame split in the middle of a field", () => {
    const first = parseSseChunks("event: notif");
    expect(first.events).toEqual([]);
    const second = parseSseChunks('ication\ndata: {"id"', first.remainder);
    expect(second.events).toEqual([]);
    const third = parseSseChunks(":1}\n\n", second.remainder);
    expect(third.events).toEqual([{ event: "notification", data: '{"id":1}' }]);
    expect(third.remainder).toBe("");
  });

  it("reassembles a frame split between lines", () => {
    const first = parseSseChunks("event: notification\n");
    const second = parseSseChunks("data: x\n", first.remainder);
    expect(second.events).toEqual([]);
    const third = parseSseChunks("\n", second.remainder);
    expect(third.events).toEqual([{ event: "notification", data: "x" }]);
  });

  it("handles CRLF line endings", () => {
    const { events } = parseSseChunks("event: a\r\ndata: b\r\n\r\n");
    expect(events).toEqual([{ event: "a", data: "b" }]);
  });

  it("handles a CRLF split between chunks without a phantom event", () => {
    const first = parseSseChunks("data: b\r");
    const second = parseSseChunks("\n\r", first.remainder);
    const third = parseSseChunks("\n", second.remainder);
    expect([...first.events, ...second.events, ...third.events]).toEqual([
      { event: "message", data: "b" },
    ]);
  });

  it("joins multi-line data with newlines", () => {
    const { events } = parseSseChunks("data: one\ndata: two\ndata:three\n\n");
    expect(events).toEqual([{ event: "message", data: "one\ntwo\nthree" }]);
  });

  it("ignores comment and heartbeat lines", () => {
    const { events, remainder } = parseSseChunks(
      ": heartbeat\n\nevent: x\n: inline comment\ndata: y\n\n",
    );
    expect(events).toEqual([{ event: "x", data: "y" }]);
    expect(remainder).toBe("");
  });

  it("reads the id field", () => {
    const { events } = parseSseChunks("id: 7\nevent: x\ndata: y\n\n");
    expect(events).toEqual([{ event: "x", data: "y", id: "7" }]);
  });

  it("returns two events from one chunk", () => {
    const { events } = parseSseChunks(
      "event: connected\ndata: {}\n\nevent: notification\ndata: 1\n\n",
    );
    expect(events.map((event) => event.event)).toEqual([
      "connected",
      "notification",
    ]);
  });

  it("dispatches nothing for empty data or blank lines", () => {
    expect(parseSseChunks("event: x\ndata:\n\n").events).toEqual([]);
    expect(parseSseChunks("event: x\n\n").events).toEqual([]);
    expect(parseSseChunks("\n\n\n").events).toEqual([]);
  });

  it("keeps a trailing partial frame in the remainder", () => {
    const { events, remainder } = parseSseChunks("data: a\n\ndata: b\nda");
    expect(events).toEqual([{ event: "message", data: "a" }]);
    expect(remainder).toBe("data: b\nda");
  });
});

describe("nextBackoffMs", () => {
  it("doubles from 1 s up to 30 s", () => {
    const delays = [0, 1, 2, 3, 4, 5, 6, 7].map((attempt) =>
      nextBackoffMs(attempt, { random: () => 1 }),
    );
    expect(delays).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000,
    ]);
  });

  it("applies jitter between half and the full delay", () => {
    expect(nextBackoffMs(2, { random: () => 0 })).toBe(2000);
    expect(nextBackoffMs(2, { random: () => 1 })).toBe(4000);
  });
});

const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

interface Harness {
  fetchMock: ReturnType<typeof vi.fn>;
  times: number[];
  statuses: Array<[StreamStatus, number | undefined]>;
  connected: ReturnType<typeof vi.fn<() => void>>;
  events: string[];
}

const setup = (
  behaviours: Array<
    (signal: AbortSignal | undefined) => Response | Promise<Response>
  >,
  options: {
    getToken?: () => Promise<string | null>;
    random?: () => number;
  } = {},
) => {
  const times: number[] = [];
  let index = 0;
  const fetchMock = vi.fn(
    async (_url: RequestInfo | URL, init?: RequestInit) => {
      times.push(Date.now());
      const behaviour =
        behaviours[Math.min(index, behaviours.length - 1)] ??
        (() => new Response(null, { status: 500 }));
      index += 1;
      return behaviour(init?.signal ?? undefined);
    },
  );
  const harness: Harness = {
    fetchMock,
    times,
    statuses: [],
    connected: vi.fn<() => void>(),
    events: [],
  };
  const stream = createNotificationStream({
    baseUrl: "http://api.test/api/v1",
    role: "client",
    scope: "agency",
    getToken: options.getToken ?? (async () => "tok"),
    fetch: fetchMock as unknown as typeof fetch,
    backoff: { random: options.random ?? (() => 1) },
    onEvent: (event) => harness.events.push(event.data),
    onStatus: (status, info) =>
      harness.statuses.push([status, info?.httpStatus]),
    onConnected: () => harness.connected(),
  });
  return { stream, ...harness };
};

const endedBody =
  (text = "") =>
  () =>
    new Response(text, { status: 200 });

describe("createNotificationStream", () => {
  it("requests the stream with role, scope and a bearer token", async () => {
    vi.useFakeTimers();
    const { stream, fetchMock } = setup([
      () => sseResponse(undefined).response,
    ]);
    stream.start();
    await vi.advanceTimersByTimeAsync(0);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "http://api.test/api/v1/notifications/stream?role=client&scope=agency",
    );
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer tok",
    });
    stream.stop();
  });

  it("reconnects after a clean end of stream", async () => {
    vi.useFakeTimers();
    const { stream, fetchMock, statuses } = setup([
      endedBody("event: notification\ndata: 1\n\n"),
      () => sseResponse(undefined).response,
    ]);
    stream.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(statuses.map(([status]) => status)).toContain("closed");

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    stream.stop();
  });

  it("follows the backoff sequence after errors", async () => {
    vi.useFakeTimers();
    const { stream, times } = setup([
      () => new Response(null, { status: 500 }),
    ]);
    stream.start();
    await vi.advanceTimersByTimeAsync(200_000);
    stream.stop();

    const gaps = times.slice(1).map((time, i) => time - (times[i] ?? 0));
    expect(gaps.slice(0, 7)).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000,
    ]);
  });

  it("keeps every delay inside the jitter bounds", async () => {
    vi.useFakeTimers();
    const { stream, times } = setup(
      [() => new Response(null, { status: 503 })],
      { random: seeded(42) },
    );
    stream.start();
    await vi.advanceTimersByTimeAsync(400_000);
    stream.stop();

    const gaps = times.slice(1).map((time, i) => time - (times[i] ?? 0));
    expect(gaps.length).toBeGreaterThan(8);
    gaps.forEach((gap, attempt) => {
      const ceiling = Math.min(30_000, 1000 * 2 ** attempt);
      expect(gap).toBeGreaterThanOrEqual(ceiling * 0.5 - 1);
      expect(gap).toBeLessThanOrEqual(ceiling);
    });
    expect(new Set(gaps.slice(0, 6)).size).toBeGreaterThan(1);
  });

  it("resets the backoff after a connection stayed open for 10 s", async () => {
    vi.useFakeTimers();
    let first!: { end: () => void };
    const { stream, times } = setup([
      () => new Response(null, { status: 500 }),
      () => {
        const open = sseResponse(undefined);
        first = open;
        return open.response;
      },
      () => new Response(null, { status: 500 }),
    ]);
    stream.start();
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(10_000);
    first.end();
    await vi.advanceTimersByTimeAsync(0);
    const endedAt = Date.now();
    await vi.advanceTimersByTimeAsync(1000);
    stream.stop();

    expect(times[2]! - endedAt).toBe(1000);
  });

  it("does not reset the backoff after a short connection", async () => {
    vi.useFakeTimers();
    let first!: { end: () => void };
    const { stream, times } = setup([
      () => new Response(null, { status: 500 }),
      () => {
        const open = sseResponse(undefined);
        first = open;
        return open.response;
      },
      () => new Response(null, { status: 500 }),
    ]);
    stream.start();
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(9_000);
    first.end();
    await vi.advanceTimersByTimeAsync(0);
    const endedAt = Date.now();
    await vi.advanceTimersByTimeAsync(2000);
    stream.stop();

    expect(times[2]! - endedAt).toBe(2000);
  });

  it.each([401, 403])("stops permanently on HTTP %i", async (code) => {
    vi.useFakeTimers();
    const { stream, fetchMock, statuses } = setup([
      () => new Response(null, { status: code }),
    ]);
    stream.start();
    await vi.advanceTimersByTimeAsync(300_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(statuses).toContainEqual(["error", code]);
  });

  it("stops without a request when there is no token", async () => {
    vi.useFakeTimers();
    const { stream, fetchMock, statuses } = setup([endedBody()], {
      getToken: async () => null,
    });
    stream.start();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(statuses).toContainEqual(["error", 401]);
  });

  it("fetches a fresh token on every attempt", async () => {
    vi.useFakeTimers();
    let n = 0;
    const getToken = vi.fn(async () => `tok-${++n}`);
    const { stream, fetchMock } = setup([endedBody()], { getToken });
    stream.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    stream.stop();

    expect(getToken).toHaveBeenCalledTimes(3);
    const auth = fetchMock.mock.calls.map(
      ([, init]) =>
        ((init as RequestInit).headers as Record<string, string>).Authorization,
    );
    expect(auth).toEqual(["Bearer tok-1", "Bearer tok-2", "Bearer tok-3"]);
  });

  it("never overlaps attempts", async () => {
    vi.useFakeTimers();
    const { stream, fetchMock } = setup([
      () => sseResponse(undefined).response,
    ]);
    stream.start();
    stream.start();
    await vi.advanceTimersByTimeAsync(0);
    stream.start();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    stream.stop();
  });

  it("does not run two loops after stop followed by start", async () => {
    vi.useFakeTimers();
    const { stream, fetchMock } = setup([endedBody()]);
    stream.start();
    await vi.advanceTimersByTimeAsync(0);
    stream.stop();
    stream.start();
    await vi.advanceTimersByTimeAsync(0);
    const afterRestart = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);

    expect(fetchMock.mock.calls.length - afterRestart).toBe(1);
    stream.stop();
  });

  it("aborts the in-flight read on stop and does not retry", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const { stream, fetchMock, statuses } = setup([
      (s) => {
        signal = s;
        return sseResponse(s).response;
      },
    ]);
    stream.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(signal?.aborted).toBe(false);

    stream.stop();
    expect(signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(120_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(statuses[statuses.length - 1]?.[0]).toBe("closed");
  });

  it("calls onConnected on every successful connect", async () => {
    vi.useFakeTimers();
    const { stream, connected } = setup([
      endedBody(),
      () => new Response(null, { status: 500 }),
      endedBody(),
    ]);
    stream.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(connected).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(4000);
    stream.stop();

    expect(connected.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("delivers events split across network chunks", async () => {
    vi.useFakeTimers();
    let open!: ReturnType<typeof sseResponse>;
    const { stream, events } = setup([
      () => {
        open = sseResponse(undefined);
        return open.response;
      },
    ]);
    stream.start();
    await vi.advanceTimersByTimeAsync(0);
    open.push("event: notification\nda");
    await vi.advanceTimersByTimeAsync(0);
    open.push('ta: {"id":"1"}\n\n: heartbeat\n\n');
    await vi.advanceTimersByTimeAsync(0);

    expect(events).toEqual(['{"id":"1"}']);
    stream.stop();
  });
});

const requestedUrl = async (baseUrl: string, scope?: string) => {
  let capture!: (url: string) => void;
  const captured = new Promise<string>((resolve) => {
    capture = resolve;
  });
  const stream = createNotificationStream({
    baseUrl,
    role: "client",
    scope,
    getToken: async () => "tok",
    fetch: (async (url: RequestInfo | URL, init?: RequestInit) => {
      capture(String(url));
      return sseResponse(init?.signal ?? undefined).response;
    }) as typeof fetch,
    onEvent: () => undefined,
  });
  stream.start();
  const url = await captured;
  stream.stop();
  return url;
};

describe("notification stream url", () => {
  it.each([
    ["http://api.test", "http://api.test"],
    ["http://api.test/", "http://api.test"],
    ["http://api.test///", "http://api.test"],
    ["http://api.test/api/v1", "http://api.test"],
    ["http://api.test/api/v1/", "http://api.test"],
    ["http://api.test/api/v1///", "http://api.test"],
  ])("normalizes %s", async (baseUrl, origin) => {
    expect(await requestedUrl(baseUrl)).toBe(
      `${origin}/api/v1/notifications/stream?role=client`,
    );
  });

  it("adds the scope when given", async () => {
    expect(await requestedUrl("http://api.test/api/v1/", "agency")).toBe(
      "http://api.test/api/v1/notifications/stream?role=client&scope=agency",
    );
  });

  it("finishes quickly on a base url with a very long run of slashes", async () => {
    const baseUrl = "http://x" + "/".repeat(100000) + "a";
    const started = performance.now();
    await requestedUrl(baseUrl);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
