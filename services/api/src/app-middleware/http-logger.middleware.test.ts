import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createRootLogger } from "../config/logger.js";
import { captureLogs } from "../test/support/capture-logs.js";
import { createHttpLogger } from "./http-logger.middleware.js";
import { requestIdMiddleware } from "./request-id.middleware.js";

const build = () => {
  const { stream, output } = captureLogs();
  const app = express();
  app.use(requestIdMiddleware);
  app.use(createHttpLogger(createRootLogger(stream, "info")));
  app.get("/api/v1/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/api/v1/things", (req, res) => {
    void req.logger.info({ message: "inside handler", eventName: "test.in" });
    res.status(201).json({ ok: true });
  });
  return { app, output };
};

describe("http logger", () => {
  it("logs id and status without headers or query values", async () => {
    const { app, output } = build();
    const response = await request(app)
      .get("/api/v1/things?token=test-query-value")
      .set("Authorization", "Bearer test-bearer-value")
      .set("Cookie", "sid=test-cookie-value");

    const text = output();
    const requestId = response.headers["x-request-id"] as string;

    expect(text).toContain(requestId);
    expect(text).toContain("201");
    expect(text).toContain("inside handler");
    expect(text).not.toContain("test-bearer-value");
    expect(text).not.toContain("test-cookie-value");
    expect(text).not.toContain("test-query-value");
  });

  it("does not log health checks", async () => {
    const { app, output } = build();
    await request(app).get("/api/v1/health");

    expect(output()).toBe("");
  });
});
