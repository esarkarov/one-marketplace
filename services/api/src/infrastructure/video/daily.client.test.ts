import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  env: { dailyApiKey: "daily_key" as string | undefined },
  fetch: vi.fn(),
}));

vi.mock("@/config/env.js", () => ({ env: hoisted.env }));

const {
  createDailyJoinUrl,
  createDailyMeetingToken,
  createDailyRoom,
  DailyRequestError,
} = await import("./daily.client.js");

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const lastRequest = () => {
  const [url, init] = hoisted.fetch.mock.calls.at(-1) as [string, RequestInit];
  return { url, body: JSON.parse(init.body as string) };
};

beforeEach(() => {
  hoisted.env.dailyApiKey = "daily_key";
  hoisted.fetch.mockReset();
  vi.stubGlobal("fetch", hoisted.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createDailyRoom", () => {
  it("creates the room private", async () => {
    hoisted.fetch.mockResolvedValue(
      jsonResponse({
        id: "r",
        name: "room-a",
        url: "https://x.daily.co/room-a",
      }),
    );

    await createDailyRoom("room-a");

    const { url, body } = lastRequest();
    expect(url).toBe("https://api.daily.co/v1/rooms");
    expect(body.privacy).toBe("private");
    expect(body.name).toBe("room-a");
    expect(body.properties.eject_at_room_exp).toBe(true);
  });
});

describe("dailyRequest timeout", () => {
  it("passes an 8 s timeout signal to every request", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    hoisted.fetch.mockResolvedValue(
      jsonResponse({ id: "r", name: "room-a", url: "u" }),
    );

    await createDailyRoom("room-a");

    expect(timeoutSpy).toHaveBeenCalledWith(8_000);
    const [, init] = hoisted.fetch.mock.calls.at(-1) as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    timeoutSpy.mockRestore();
  });

  it("rejects with timedOut when fetch never resolves", async () => {
    const controller = new AbortController();
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(controller.signal);
    hoisted.fetch.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason),
          );
        }),
    );

    const pending = createDailyRoom("room-a");
    const assertion = expect(pending).rejects.toMatchObject({
      name: "DailyRequestError",
      timedOut: true,
      status: undefined,
      message: "Daily API request timed out.",
    });
    controller.abort(new DOMException("timed out", "TimeoutError"));

    await assertion;
    await expect(pending).rejects.toBeInstanceOf(DailyRequestError);
    timeoutSpy.mockRestore();
  });

  it("reports a timeout while the response body is being read", async () => {
    hoisted.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new DOMException("timed out", "TimeoutError")),
    });

    await expect(createDailyRoom("room-a")).rejects.toMatchObject({
      name: "DailyRequestError",
      timedOut: true,
    });
  });

  it("keeps the message and adds the status on a non-ok response", async () => {
    hoisted.fetch.mockResolvedValue(
      jsonResponse({ error: "e", info: "bad room" }, 400),
    );

    await expect(createDailyRoom("room-a")).rejects.toMatchObject({
      name: "DailyRequestError",
      message: "bad room",
      status: 400,
      timedOut: false,
    });
  });

  it("uses the generic message when the error body is empty", async () => {
    hoisted.fetch.mockResolvedValue(new Response("not json", { status: 502 }));

    await expect(createDailyRoom("room-a")).rejects.toThrow(
      "Daily API request failed (502).",
    );
  });

  it("does not wrap a missing key in DailyRequestError", async () => {
    hoisted.env.dailyApiKey = undefined;

    const error = await createDailyRoom("room-a").catch((e: unknown) => e);

    expect(error).not.toBeInstanceOf(DailyRequestError);
  });
});

describe("createDailyMeetingToken", () => {
  it("mints a non-owner token for the room with the public user id", async () => {
    hoisted.fetch.mockResolvedValue(jsonResponse({ token: "tok" }));

    const result = await createDailyMeetingToken({
      roomName: "room-a",
      userId: "11111111-1111-4111-8111-111111111111",
      userName: "Ada",
      expiresAt: 1_900_000_000,
    });

    expect(result).toEqual({ token: "tok" });
    const { url, body } = lastRequest();
    expect(url).toBe("https://api.daily.co/v1/meeting-tokens");
    expect(body).toEqual({
      properties: {
        room_name: "room-a",
        is_owner: false,
        user_name: "Ada",
        user_id: "11111111-1111-4111-8111-111111111111",
        exp: 1_900_000_000,
      },
    });
  });

  it("throws the Daily error message when Daily fails", async () => {
    hoisted.fetch.mockResolvedValue(
      jsonResponse({ error: "invalid-request-error", info: "bad room" }, 400),
    );

    await expect(
      createDailyMeetingToken({
        roomName: "room-a",
        userId: "u",
        userName: "n",
        expiresAt: 1,
      }),
    ).rejects.toThrow("bad room");
  });

  it("throws the missing-key error without calling Daily", async () => {
    hoisted.env.dailyApiKey = undefined;

    await expect(
      createDailyMeetingToken({
        roomName: "room-a",
        userId: "u",
        userName: "n",
        expiresAt: 1,
      }),
    ).rejects.toThrow("DAILY_API_KEY is missing from the environment.");
    expect(hoisted.fetch).not.toHaveBeenCalled();
  });
});

describe("Daily retry policies", () => {
  const tokenInput = {
    roomName: "room-a",
    userId: "u",
    userName: "n",
    expiresAt: 1,
  };

  it("never retries room creation", async () => {
    hoisted.fetch.mockImplementation(async () =>
      jsonResponse({ info: "busy" }, 503),
    );

    await expect(createDailyRoom("room-a")).rejects.toMatchObject({
      name: "DailyRequestError",
      message: "busy",
      status: 503,
      timedOut: false,
    });
    expect(hoisted.fetch).toHaveBeenCalledTimes(1);
  });

  it("retries a token request once after a 502", async () => {
    hoisted.fetch
      .mockResolvedValueOnce(jsonResponse({ info: "bad gateway" }, 502))
      .mockResolvedValueOnce(jsonResponse({ token: "tok" }));

    await expect(createDailyMeetingToken(tokenInput)).resolves.toEqual({
      token: "tok",
    });
    expect(hoisted.fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps the Daily error after the token retry is used up", async () => {
    hoisted.fetch.mockImplementation(async () =>
      jsonResponse({ info: "unavailable" }, 503),
    );

    const error = await createDailyMeetingToken(tokenInput).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(DailyRequestError);
    expect(error).toMatchObject({
      message: "unavailable",
      status: 503,
      timedOut: false,
    });
    expect(hoisted.fetch).toHaveBeenCalledTimes(2);
  });
});

describe("createDailyJoinUrl", () => {
  const startedAt = () => new Date(Date.now() - 60_000);

  it("appends the token and expires before the room does", async () => {
    hoisted.fetch.mockResolvedValue(jsonResponse({ token: "tok en" }));
    const started = startedAt();

    const joinUrl = await createDailyJoinUrl({
      roomName: "room-a",
      roomUrl: "https://x.daily.co/room-a",
      startedAt: started,
      userId: "pub-id",
      userName: "Ada",
    });

    expect(joinUrl).toBe("https://x.daily.co/room-a?t=tok+en");
    const roomExpiryUpperBound =
      Math.floor(started.getTime() / 1000) + 60 * 60 * 6;
    const { exp } = lastRequest().body.properties;
    expect(exp).toBeLessThan(roomExpiryUpperBound);
    expect(exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("returns the stored url without calling Daily when the room has expired", async () => {
    const joinUrl = await createDailyJoinUrl({
      roomName: "room-a",
      roomUrl: "https://x.daily.co/room-a",
      startedAt: new Date(Date.now() - 7 * 60 * 60 * 1000),
      userId: "pub-id",
      userName: "Ada",
    });

    expect(joinUrl).toBe("https://x.daily.co/room-a");
    expect(hoisted.fetch).not.toHaveBeenCalled();
  });

  it("propagates a Daily failure", async () => {
    hoisted.fetch.mockResolvedValue(jsonResponse({ info: "down" }, 500));

    await expect(
      createDailyJoinUrl({
        roomName: "room-a",
        roomUrl: "https://x.daily.co/room-a",
        startedAt: startedAt(),
        userId: "pub-id",
        userName: "Ada",
      }),
    ).rejects.toThrow("down");
  });
});
