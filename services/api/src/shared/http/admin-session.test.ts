import { createHmac } from "node:crypto";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

const secret = "s".repeat(32);

vi.mock("../../config/env.js", () => ({
  env: { adminSessionSecret: "s".repeat(32) },
}));

const { requireAdminSession, requireAdminSessionAllowingQueryToken } =
  await import("./admin-session.middleware.js");
const { errorHandler } = await import("./error.middleware.js");

const token = (expiresAt = Date.now() + 60_000) => {
  const raw = String(expiresAt);
  const signature = createHmac("sha256", secret).update(raw).digest("hex");
  return `${raw}.${signature}`;
};

const app = express();
app.use((req, _res, next) => {
  req.logger = {
    warn: async () => undefined,
    info: async () => undefined,
    error: async () => undefined,
  } as unknown as typeof req.logger;
  next();
});
app.get("/stream", requireAdminSessionAllowingQueryToken, (_req, res) => {
  res.status(200).json({ ok: true });
});
app.get("/other", requireAdminSession, (_req, res) => {
  res.status(200).json({ ok: true });
});
app.use(errorHandler);

describe("admin session", () => {
  it("accepts a bearer token on every route", async () => {
    const header = `Bearer ${token()}`;

    expect(
      (await request(app).get("/other").set("Authorization", header)).status,
    ).toBe(200);
    expect(
      (await request(app).get("/stream").set("Authorization", header)).status,
    ).toBe(200);
  });

  it("accepts the query token only on the stream route", async () => {
    const query = { token: token() };

    expect((await request(app).get("/stream").query(query)).status).toBe(200);
    expect((await request(app).get("/other").query(query)).status).toBe(401);
  });

  it("rejects an expired token", async () => {
    const response = await request(app)
      .get("/stream")
      .query({ token: token(Date.now() - 1000) });

    expect(response.status).toBe(401);
  });
});
