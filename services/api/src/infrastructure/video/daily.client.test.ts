import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  env: { dailyApiKey: "daily_key" as string | undefined },
  fetch: vi.fn(),
}));

vi.mock("@/config/env.js", () => ({ env: hoisted.env }));

const { createDailyJoinUrl, createDailyMeetingToken, createDailyRoom } =
  await import("./daily.client.js");

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
