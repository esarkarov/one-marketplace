import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import {
  PUBLIC_SEARCH_LIMIT,
  PUBLIC_SEARCH_WINDOW_MS,
} from "../constants/rate-limit.constants.js";

vi.mock("../../infrastructure/cache/redis.client.js", () => ({
  redis: { isReady: false },
}));

vi.mock("../../config/env.js", () => ({ env: { nodeEnv: "production" } }));

const { publicSearchLimiter } = await import("./rate-limit.middleware.js");

describe("publicSearchLimiter", () => {
  it("is configured for 60 requests per minute", () => {
    expect(PUBLIC_SEARCH_LIMIT).toBe(60);
    expect(PUBLIC_SEARCH_WINDOW_MS).toBe(60_000);
  });

  it("blocks the request after the limit with the standard 429 shape", async () => {
    const app = express();
    app.get("/search", publicSearchLimiter, (_req, res) => {
      res.json({ success: true });
    });

    const allowed = await Promise.all(
      Array.from({ length: PUBLIC_SEARCH_LIMIT }, () =>
        request(app).get("/search"),
      ),
    );
    expect(allowed.every((response) => response.status === 200)).toBe(true);

    const blocked = await request(app).get("/search");
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({
      success: false,
      message: "Too many requests. Please try again later.",
      code: "RATE_LIMITED",
      requestId: expect.any(String),
    });
  });
});
