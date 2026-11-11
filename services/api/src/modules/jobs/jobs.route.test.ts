import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../app.js";
import { connectRedis, disconnectRedis } from "../../config/redis.js";
import { pool } from "../../database/client.js";

const id = "123e4567-e89b-42d3-a456-426614174000";

beforeAll(async () => {
  await connectRedis();
});

afterAll(async () => {
  await disconnectRedis();
  await pool.end();
});

describe("jobs routes validation order", () => {
  it.each([
    ["post", "/api/v1/jobs"],
    ["get", "/api/v1/jobs"],
    ["get", "/api/v1/jobs/saved"],
    ["post", `/api/v1/jobs/saved/${id}`],
    ["delete", `/api/v1/jobs/saved/${id}`],
    ["get", `/api/v1/jobs/${id}`],
    ["put", `/api/v1/jobs/${id}`],
    ["delete", `/api/v1/jobs/${id}`],
    ["post", "/api/v1/jobs/saved/not-a-uuid"],
    ["put", "/api/v1/jobs/not-a-uuid"],
  ] as const)("%s %s returns 401 without a token", async (method, path) => {
    const response = await request(app)
      [method](path)
      .send(
        method === "post" || method === "put" ? "not-an-object" : undefined,
      );

    expect(response.status).toBe(401);
  });
});

describe("GET /api/v1/jobs/public", () => {
  it("rejects array and object query values", async () => {
    const response = await request(app).get(
      "/api/v1/jobs/public?sort[]=x&query[a]=b&levels[]=z",
    );

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 200 for a valid query", async () => {
    const response = await request(app).get(
      "/api/v1/jobs/public?sort=budget&offset=0&minBudgetCents=500",
    );

    expect(response.status).toBe(200);
  });
});
