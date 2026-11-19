import { createHmac } from "node:crypto";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const secret = Buffer.from("daily-webhook-secret-bytes").toString("base64");

const mocks = vi.hoisted(() => ({
  store: new Map<string, string>(),
  setCalls: 0,
  endMeeting: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

vi.mock("@/config/env.js", () => ({
  env: {
    dailyWebhookSecret: Buffer.from("daily-webhook-secret-bytes").toString(
      "base64",
    ),
  },
}));

vi.mock("@/infrastructure/cache/redis.client.js", () => ({
  redis: {
    isReady: true,
    set: async (key: string, value: string) => {
      mocks.setCalls += 1;
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

vi.mock("@/modules/meetings/services/meetings.service.js", () => ({
  endMeetingByRoomName: mocks.endMeeting,
  startMeeting: vi.fn(),
}));

const { dailyWebhookHandler } =
  await import("@/modules/meetings/controllers/meetings.controller.js");
const { errorHandler } = await import("@/middleware/error/error.middleware.js");

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

const sendSigned = (body: string) => {
  const timestamp = nowSeconds();
  return request(app)
    .post("/webhook")
    .set("Content-Type", "application/json")
    .set("X-Webhook-Timestamp", timestamp)
    .set("X-Webhook-Signature", sign(timestamp, body))
    .send(body);
};

beforeEach(() => {
  mocks.store.clear();
  mocks.setCalls = 0;
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

describe("Daily webhook edges", () => {
  it("answers 500 on a signed body that is not JSON, without processing", async () => {
    const response = await sendSigned("this is not json");

    expect(response.status).toBe(500);
    expect(mocks.endMeeting).not.toHaveBeenCalled();
    expect(mocks.setCalls).toBe(0);
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it("rejects missing headers with 400, the rejection log and no processing", async () => {
    const response = await request(app)
      .post("/webhook")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ id: "evt_1", type: "meeting.ended" }));

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Invalid Daily webhook signature.");
    expect(mocks.warn).toHaveBeenCalledTimes(1);
    expect(mocks.warn).toHaveBeenCalledWith({
      message: "Webhook signature rejected",
      eventName: "webhook.inbound.rejected",
      attributes: {
        "webhook.source": "daily",
        "webhook.reject_reason": "invalid_signature",
      },
    });
    expect(mocks.endMeeting).not.toHaveBeenCalled();
    expect(mocks.setCalls).toBe(0);
  });

  it("does not claim an event without an id and still processes it", async () => {
    const body = JSON.stringify({
      type: "meeting.ended",
      payload: { room: "room_1" },
    });

    const first = await sendSigned(body);
    const second = await sendSigned(body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body).toEqual({
      success: true,
      message: "Webhook processed.",
    });
    expect(mocks.setCalls).toBe(0);
    expect(mocks.endMeeting).toHaveBeenCalledTimes(2);
  });

  it("answers the duplicate with the already-processed body", async () => {
    const body = JSON.stringify({
      id: "evt_9",
      type: "meeting.ended",
      payload: { room: "room_1" },
    });

    await sendSigned(body);
    const second = await sendSigned(body);

    expect(second.status).toBe(200);
    expect(second.body).toEqual({
      success: true,
      message: "Webhook already processed.",
    });
    expect(mocks.endMeeting).toHaveBeenCalledTimes(1);
  });

  it("ignores other event types and rooms but still claims the id", async () => {
    const other = await sendSigned(
      JSON.stringify({ id: "evt_a", type: "meeting.started", payload: {} }),
    );
    const noRoom = await sendSigned(
      JSON.stringify({ id: "evt_b", type: "meeting.ended", payload: {} }),
    );

    expect(other.status).toBe(200);
    expect(noRoom.status).toBe(200);
    expect(mocks.endMeeting).not.toHaveBeenCalled();
    expect(mocks.store.has("webhook:daily:evt_a")).toBe(true);
    expect(mocks.store.has("webhook:daily:evt_b")).toBe(true);
  });

  it("logs the ended meeting once with its attributes", async () => {
    const response = await sendSigned(
      JSON.stringify({
        id: "evt_c",
        type: "meeting.ended",
        payload: { room: "room_1" },
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.info).toHaveBeenCalledTimes(1);
    expect(mocks.info).toHaveBeenCalledWith({
      message: "Meeting ended",
      eventName: "task.meeting.completed",
      attributes: {
        "task.meeting.id": "m1",
        "task.meeting.conversation_id": "c1",
        "task.meeting.duration_minutes": 5,
      },
    });
  });

  it("does not log when no meeting was ended", async () => {
    mocks.endMeeting.mockResolvedValue(null);

    const response = await sendSigned(
      JSON.stringify({
        id: "evt_d",
        type: "meeting.ended",
        payload: { room: "room_x" },
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.info).not.toHaveBeenCalled();
  });
});
