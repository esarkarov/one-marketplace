import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createRootLogger } from "@/config/logger.js";
import { captureLogs } from "@/test/support/capture-logs.js";
import { errorHandler } from "@/middleware/error/error.middleware.js";
import { createHttpLogger } from "@/middleware/http-logger/http-logger.middleware.js";
import { requestIdMiddleware } from "@/middleware/request-id/request-id.middleware.js";
import { isLargeBodyRoute, jsonBody } from "./json-body.middleware.js";

describe("isLargeBodyRoute", () => {
  it.each([
    ["POST", "/api/v1/jobs"],
    ["PUT", "/api/v1/jobs/abc"],
    ["POST", "/api/v1/conversations/abc/messages"],
    ["PUT", "/api/v1/freelancer/profile"],
    ["PUT", "/api/v1/agency"],
  ])("allows large bodies for %s %s", (method, path) => {
    expect(isLargeBodyRoute(method, path)).toBe(true);
  });

  it.each([
    ["GET", "/api/v1/jobs/saved/abc"],
    ["POST", "/api/v1/agency"],
    ["POST", "/api/v1/proposals"],
  ])("keeps the default limit for %s %s", (method, path) => {
    expect(isLargeBodyRoute(method, path)).toBe(false);
  });
});

describe("jsonBody", () => {
  const buildApp = () => {
    const app = express();
    app.use(jsonBody);
    app.all(/.*/, (req, res) => {
      res.json({ parsed: req.body !== undefined && req.body !== null });
    });
    return app;
  };

  it("skips parsing on large body routes", async () => {
    const response = await request(buildApp())
      .post("/api/v1/jobs")
      .set("Content-Type", "application/json")
      .send("{bad");

    expect(response.status).toBe(200);
    expect(response.body.parsed).toBe(false);
  });

  it("parses other routes with the default parser", async () => {
    const response = await request(buildApp())
      .post("/api/v1/proposals")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ a: 1 }));

    expect(response.body.parsed).toBe(true);
  });

  it("rejects invalid JSON on other routes", async () => {
    const response = await request(buildApp())
      .post("/api/v1/proposals")
      .set("Content-Type", "application/json")
      .send("{bad");

    expect(response.status).toBe(400);
  });
});

describe("jsonBody parse failures", () => {
  const secret = "test-secret-pw-7731";
  const fragment = secret.slice(0, 8);
  const buildApp = () => {
    const { stream, output } = captureLogs();
    const app = express();
    app.use(requestIdMiddleware);
    app.use(createHttpLogger(createRootLogger(stream, "trace")));
    app.use(jsonBody);
    app.post("/api/v1/auth/sign-up", (_req, res) => {
      res.status(201).json({ ok: true });
    });
    app.use(errorHandler);
    return { app, output };
  };

  it("answers a fixed message that repeats no part of a malformed body", async () => {
    const { app, output } = buildApp();
    const response = await request(app)
      .post("/api/v1/auth/sign-up")
      .set("Content-Type", "application/json")
      .send(`{"password":${secret},"role":"client"}`);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      message: "Invalid JSON body.",
      code: "BAD_REQUEST",
      requestId: response.headers["x-request-id"],
    });
    expect(JSON.stringify(response.body)).not.toContain(fragment);
    expect(JSON.stringify(response.body)).not.toContain("assword");
    expect(output()).toContain(response.headers["x-request-id"] as string);
    expect(output()).not.toContain(fragment);
    expect(output()).not.toContain("assword");
  });

  it("keeps the 413 answer for a body over the limit", async () => {
    const { app } = buildApp();
    const response = await request(app)
      .post("/api/v1/auth/sign-up")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ padding: "x".repeat(200 * 1024) }));

    expect(response.status).toBe(413);
    expect(response.body.message).not.toBe("Invalid JSON body.");
    expect(response.body.code).toBe("PAYLOAD_TOO_LARGE");
  });
});
