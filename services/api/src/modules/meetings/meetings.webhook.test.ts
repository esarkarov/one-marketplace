import { createHmac } from "node:crypto";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const secret = Buffer.from("daily-webhook-secret-bytes").toString("base64");

const mocks = vi.hoisted(() => ({
  store: new Map<string, string>(),
  ready: true,
  setError: null as Error | null,
  lastSetOptions: null as unknown,
  endMeeting: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

vi.mock("../../config/env.js", () => ({
  env: {
    dailyWebhookSecret: Buffer.from("daily-webhook-secret-bytes").toString(
      "base64",
    ),
  },
}));

vi.mock("../../infrastructure/redis.js", () => ({
  redis: {
    get isReady() {
      return mocks.ready;
    },
    set: async (key: string, value: string, options: unknown) => {
      if (mocks.setError) throw mocks.setError;
      mocks.lastSetOptions = options;
      if (mocks.store.has(key)) return null;
      mocks.store.set(key, value);
      return "OK";
    },
    del: async (key: string) => {
      mocks.store.delete(key);
      return 1;
    },
  },
}));

vi.mock("./meetings.service.js", () => ({
  endMeetingByRoomName: mocks.endMeeting,
  startMeeting: vi.fn(),
}));

const { dailyWebhookHandler } = await import("./meetings.controller.js");
const { errorHandler } = await import("../../shared/http/error.middleware.js");

const app = express();
app.use((req, _res, next) => {
  req.logger = {
    warn: mocks.warn,
    info: mocks.info,
    error: async () => undefined,
  } as unknown as typeof req.logger;
  next();
});
app.post("/webhook", express.raw({ type: "*/*" }), dailyWebhookHandler);
app.use(errorHandler);

const sign = (timestamp: string, body: string) =>
  createHmac("sha256", Buffer.from(secret, "base64"))
    .update(`${timestamp}.${body}`)
    .digest("base64");

const nowSeconds = () => String(Math.floor(Date.now() / 1000));

const eventBody = (id = "evt_1") =>
  JSON.stringify({
    id,
    type: "meeting.ended",
    payload: { room: "room_1" },
  });

const post = (body: string, timestamp: string, signature: string) =>
  request(app)
    .post("/webhook")
    .set("Content-Type", "application/json")
    .set("X-Webhook-Timestamp", timestamp)
    .set("X-Webhook-Signature", signature)
    .send(body);

beforeEach(() => {
  mocks.store.clear();
  mocks.ready = true;
  mocks.setError = null;
  mocks.lastSetOptions = null;
  mocks.endMeeting.mockReset();
  mocks.endMeeting.mockResolvedValue({
    id: "m1",
    conversationId: "c1",
    durationMinutes: 5,
  });
  mocks.warn.mockReset();
  mocks.warn.mockResolvedValue(undefined);
  mocks.info.mockReset();
  mocks.info.mockResolvedValue(undefined);
});

describe("Daily webhook signature", () => {
  it("accepts a signature over the raw bytes", async () => {
    const body = `{ "id": "evt_1",  "type": "meeting.ended", "payload": {"room": "room_1"} }`;
    const timestamp = nowSeconds();

    const response = await post(body, timestamp, sign(timestamp, body));

    expect(response.status).toBe(200);
    expect(mocks.endMeeting).toHaveBeenCalledWith("room_1");
  });

  it("falls back to the re-serialized body", async () => {
    const compact = eventBody();
    const spaced = JSON.stringify(JSON.parse(compact), null, 2);
    const timestamp = nowSeconds();

    const response = await post(spaced, timestamp, sign(timestamp, compact));

    expect(response.status).toBe(200);
    expect(mocks.endMeeting).toHaveBeenCalledOnce();
  });

  it("rejects a tampered body", async () => {
    const timestamp = nowSeconds();
    const signature = sign(timestamp, eventBody());

    const response = await post(
      eventBody().replace("room_1", "room_2"),
      timestamp,
      signature,
    );

    expect(response.status).toBe(400);
    expect(mocks.endMeeting).not.toHaveBeenCalled();
  });

  it("rejects a signature of a different length", async () => {
    const response = await post(eventBody(), nowSeconds(), "short");

    expect(response.status).toBe(400);
  });

  it("rejects a stale timestamp", async () => {
    const timestamp = String(Math.floor(Date.now() / 1000) - 301);

    const response = await post(
      eventBody(),
      timestamp,
      sign(timestamp, eventBody()),
    );

    expect(response.status).toBe(400);
    expect(mocks.endMeeting).not.toHaveBeenCalled();
  });

  it("rejects a timestamp too far in the future", async () => {
    const timestamp = String(Math.floor(Date.now() / 1000) + 600);

    const response = await post(
      eventBody(),
      timestamp,
      sign(timestamp, eventBody()),
    );

    expect(response.status).toBe(400);
  });

  it.each(["abc", "12.5", "-5", "", "1e3"])(
    "rejects the non-numeric timestamp %j",
    async (timestamp) => {
      const response = await post(
        eventBody(),
        timestamp,
        sign(timestamp, eventBody()),
      );

      expect(response.status).toBe(400);
    },
  );

  it("accepts millisecond timestamps within tolerance", async () => {
    const timestamp = String(Date.now());

    const response = await post(
      eventBody(),
      timestamp,
      sign(timestamp, eventBody()),
    );

    expect(response.status).toBe(200);
  });

  it("rejects stale millisecond timestamps", async () => {
    const timestamp = String(Date.now() - 301_000);

    const response = await post(
      eventBody(),
      timestamp,
      sign(timestamp, eventBody()),
    );

    expect(response.status).toBe(400);
  });
});

describe("Daily webhook replay protection", () => {
  const send = (id = "evt_1") => {
    const body = eventBody(id);
    const timestamp = nowSeconds();
    return post(body, timestamp, sign(timestamp, body));
  };

  it("processes a duplicate event id once and returns 200 both times", async () => {
    const first = await send();
    const second = await send();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(mocks.endMeeting).toHaveBeenCalledOnce();
    expect(mocks.store.has("webhook:daily:evt_1")).toBe(true);
  });

  it("processes different event ids separately", async () => {
    await send("evt_1");
    await send("evt_2");

    expect(mocks.endMeeting).toHaveBeenCalledTimes(2);
  });

  it("claims the event with NX and a 10 minute TTL", async () => {
    await send();

    expect(mocks.lastSetOptions).toEqual({
      condition: "NX",
      expiration: { type: "EX", value: 600 },
    });
  });

  it("processes two overlapping deliveries of the same event once", async () => {
    let release: (value: unknown) => void = () => undefined;
    mocks.endMeeting.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    const first = Promise.resolve(send());
    await vi.waitFor(() => expect(mocks.endMeeting).toHaveBeenCalledOnce());
    const second = await send();

    expect(second.status).toBe(200);
    expect(second.body.message).toBe("Webhook already processed.");

    release({ id: "m1", conversationId: "c1", durationMinutes: 5 });
    expect((await first).status).toBe(200);
    expect(mocks.endMeeting).toHaveBeenCalledOnce();
  });

  it("releases the claim when the handler fails so a retry can run", async () => {
    mocks.endMeeting.mockRejectedValueOnce(new Error("db down"));

    const failed = await send();
    expect(failed.status).toBe(500);
    expect(mocks.store.size).toBe(0);

    const retried = await send();
    expect(retried.status).toBe(200);
    expect(mocks.endMeeting).toHaveBeenCalledTimes(2);
  });

  it("processes the event and logs a warning when Redis is unavailable", async () => {
    mocks.setError = new Error("redis down");

    const response = await send();

    expect(response.status).toBe(200);
    expect(mocks.endMeeting).toHaveBeenCalledOnce();
    expect(mocks.warn).toHaveBeenCalled();
    expect(mocks.warn.mock.calls[0]![0].eventName).toBe(
      "webhook.inbound.dedupe_unavailable",
    );
  });

  it("processes the event when the Redis client is not ready", async () => {
    mocks.ready = false;

    const response = await send();

    expect(response.status).toBe(200);
    expect(mocks.endMeeting).toHaveBeenCalledOnce();
  });
});
