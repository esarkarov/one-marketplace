import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
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
