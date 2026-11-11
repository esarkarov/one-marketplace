import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ nodeEnv: "production" }));

vi.mock("../config/env.js", () => ({
  env: {
    get nodeEnv() {
      return mocks.nodeEnv;
    },
  },
}));

const {
  CONTENT_WRITE_LIMIT,
  INVITE_WRITE_LIMIT,
  INVITE_WRITE_WINDOW_MS,
  MESSAGE_WRITE_LIMIT,
  contentWriteLimiter,
  createUserRateLimiter,
  inviteWriteLimiter,
  messageWriteLimiter,
} = await import("./user-rate-limit.middleware.js");

const createApp = (limiter: express.RequestHandler) => {
  const app = express();
  app.use((req, _res, next) => {
    const user = req.header("x-test-user");
    if (user) req.authClaims = { userId: user };
    next();
  });
  app.post("/", limiter, (_req, res) => {
    res.json({ success: true });
  });
  return app;
};

const hit = (app: express.Express, user: string, times: number) =>
  Promise.all(
    Array.from({ length: times }, () =>
      request(app).post("/").set("x-test-user", user),
    ),
  );

describe("user rate limiter", () => {
  it("uses the documented limits", () => {
    expect(MESSAGE_WRITE_LIMIT).toBe(120);
    expect(CONTENT_WRITE_LIMIT).toBe(30);
  });

  it("allows the content limit then returns 429 in the standard shape", async () => {
    const app = createApp(contentWriteLimiter());

    const allowed = await hit(app, "user_1", CONTENT_WRITE_LIMIT);
    expect(allowed.every((response) => response.status === 200)).toBe(true);

    const blocked = await request(app).post("/").set("x-test-user", "user_1");
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({
      success: false,
      message: "Too many requests. Please try again later.",
    });
  });

  it("allows 120 message writes and blocks the 121st", async () => {
    const app = createApp(messageWriteLimiter());

    const allowed = await hit(app, "user_1", MESSAGE_WRITE_LIMIT);
    expect(allowed.every((response) => response.status === 200)).toBe(true);

    const blocked = await request(app).post("/").set("x-test-user", "user_1");
    expect(blocked.status).toBe(429);
  });

  it("counts each user separately regardless of IP", async () => {
    const app = createApp(createUserRateLimiter({ limit: 2 }));

    await hit(app, "user_1", 2);
    const blocked = await request(app).post("/").set("x-test-user", "user_1");
    const other = await request(app).post("/").set("x-test-user", "user_2");

    expect(blocked.status).toBe(429);
    expect(other.status).toBe(200);
  });

  it("keeps separate limiter instances independent", async () => {
    const first = createApp(createUserRateLimiter({ limit: 1 }));
    const second = createApp(createUserRateLimiter({ limit: 1 }));

    await hit(first, "user_1", 1);

    expect((await hit(first, "user_1", 1))[0]!.status).toBe(429);
    expect((await hit(second, "user_1", 1))[0]!.status).toBe(200);
  });

  it("allows 20 invitation actions per hour in one bucket and blocks the 21st", async () => {
    expect(INVITE_WRITE_LIMIT).toBe(20);
    expect(INVITE_WRITE_WINDOW_MS).toBe(60 * 60 * 1000);

    const app = express();
    app.use((req, _res, next) => {
      req.auth = { userId: req.header("x-test-user") ?? "" } as typeof req.auth;
      next();
    });
    app.post("/invite", inviteWriteLimiter, (_req, res) => {
      res.json({ success: true });
    });
    app.delete("/invite/:id", inviteWriteLimiter, (_req, res) => {
      res.json({ success: true });
    });
    app.post("/invite/:id/resend", inviteWriteLimiter, (_req, res) => {
      res.json({ success: true });
    });

    const calls = [
      ...Array.from({ length: 10 }, () => request(app).post("/invite")),
      ...Array.from({ length: 5 }, () => request(app).delete("/invite/1")),
      ...Array.from({ length: 5 }, () => request(app).post("/invite/1/resend")),
    ].map((call) => call.set("x-test-user", "owner_1"));
    const allowed = await Promise.all(calls);
    expect(allowed.every((response) => response.status === 200)).toBe(true);

    const blocked = await request(app)
      .post("/invite/1/resend")
      .set("x-test-user", "owner_1");
    expect(blocked.status).toBe(429);

    const other = await request(app)
      .post("/invite")
      .set("x-test-user", "owner_2");
    expect(other.status).toBe(200);
  });

  it("is skipped in the test environment", async () => {
    mocks.nodeEnv = "test";
    try {
      const app = createApp(createUserRateLimiter({ limit: 1 }));
      const responses = await hit(app, "user_1", 5);
      expect(responses.every((response) => response.status === 200)).toBe(true);
    } finally {
      mocks.nodeEnv = "production";
    }
  });
});
