import { beforeEach, describe, expect, it, vi } from "vitest";

const CLERK_ID = "user_clerk_secret_123";
const PUBLIC_ID = "22222222-2222-4222-8222-222222222222";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  publicIds: new Map<string, string>(),
  displays: new Map<string, { displayName: string | null }>(),
  loggerError: vi.fn(),
}));

vi.mock("@/config/env.js", () => ({ env: { dailyApiKey: "daily_key" } }));
vi.mock("@/config/logger.js", () => ({
  logger: { error: mocks.loggerError },
}));
vi.mock("@/database/client.js", () => ({ db: {} }));
vi.mock("@/modules/auth/index.js", () => ({
  findAccountPublicIds: async () => mocks.publicIds,
  findAccountDisplays: async () => mocks.displays,
}));

const { createMeetingJoinUrls } =
  await import("@/modules/messaging/services/messaging.meeting-join.service.js");

const source = (id: string, room = "room-a") => ({
  id,
  roomName: room,
  roomUrl: `https://x.daily.co/${room}`,
  startedAt: new Date(Date.now() - 60_000),
});

beforeEach(() => {
  mocks.fetch.mockReset();
  mocks.fetch.mockImplementation(
    async () => new Response(JSON.stringify({ token: "tok" }), { status: 200 }),
  );
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.loggerError.mockReset();
  mocks.publicIds = new Map([[CLERK_ID, PUBLIC_ID]]);
  mocks.displays = new Map([[CLERK_ID, { displayName: "Ada Lovelace" }]]);
});

describe("createMeetingJoinUrls", () => {
  it("mints one token per meeting with the public id and display name, never the Clerk id", async () => {
    const urls = await createMeetingJoinUrls(
      CLERK_ID,
      [source("m1", "room-a"), source("m2", "room-b")],
      "test",
    );

    expect(urls.get("m1")).toBe("https://x.daily.co/room-a?t=tok");
    expect(urls.get("m2")).toBe("https://x.daily.co/room-b?t=tok");
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    for (const [, init] of mocks.fetch.mock.calls as [string, RequestInit][]) {
      const body = JSON.parse(init.body as string);
      expect(body.properties.user_id).toBe(PUBLIC_ID);
      expect(body.properties.user_name).toBe("Ada Lovelace");
      expect(body.properties.is_owner).toBe(false);
      expect(init.body as string).not.toContain(CLERK_ID);
    }
    expect(JSON.stringify([...urls])).not.toContain(CLERK_ID);
  });

  it("falls back to a generic name when the account has no display name", async () => {
    mocks.displays = new Map([[CLERK_ID, { displayName: null }]]);

    await createMeetingJoinUrls(CLERK_ID, [source("m1")], "test");

    const [, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).properties.user_name).toBe(
      "Participant",
    );
  });

  it("does not call Daily when there is no meeting", async () => {
    const urls = await createMeetingJoinUrls(CLERK_ID, [], "test");

    expect(urls.size).toBe(0);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("fails with a logged internal error and no Daily call when the public id is unresolved", async () => {
    mocks.publicIds = new Map();

    await expect(
      createMeetingJoinUrls(CLERK_ID, [source("m1")], "test"),
    ).rejects.toMatchObject({ statusCode: 500, code: "INTERNAL_ERROR" });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("propagates a Daily failure", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ info: "daily is down" }), { status: 500 }),
    );

    await expect(
      createMeetingJoinUrls(CLERK_ID, [source("m1")], "test"),
    ).rejects.toThrow("daily is down");
  });

  it("keeps the other meetings' tokens and reports each failure when a handler is given", async () => {
    mocks.fetch.mockImplementation(async (_url: string, init: RequestInit) =>
      JSON.parse(init.body as string).properties.room_name === "room-b"
        ? new Response(JSON.stringify({ info: "daily is down" }), {
            status: 500,
          })
        : new Response(JSON.stringify({ token: "tok" }), { status: 200 }),
    );
    const failures: string[] = [];

    const urls = await createMeetingJoinUrls(
      CLERK_ID,
      [source("m1", "room-a"), source("m2", "room-b")],
      "test",
      async (failed) => {
        failures.push(failed.id);
      },
    );

    expect(failures).toEqual(["m2"]);
    expect(urls.get("m1")).toBe("https://x.daily.co/room-a?t=tok");
    expect(urls.get("m2")).toBe("https://x.daily.co/room-b");
  });
});
