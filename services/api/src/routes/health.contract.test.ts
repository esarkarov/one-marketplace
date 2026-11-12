import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connectRedis, disconnectRedis } from "../config/redis.js";
import { pool } from "../database/client.js";
import { assertTestDatabase } from "../test/assert-test-database.js";
import { healthResponses } from "./health.responses.js";

const { app } = await import("../app.js");

beforeAll(async () => {
  assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);
  await connectRedis();
});

afterAll(async () => {
  await disconnectRedis();
  await pool.end();
});

describe("GET /health", () => {
  it("matches the 200 schema", async () => {
    const response = await request(app).get("/api/v1/health");
    expect(response.status).toBe(200);
    healthResponses.health[200].parse(response.body);
  });
});

describe("GET /ready", () => {
  it("matches the 200 schema", async () => {
    const response = await request(app).get("/api/v1/ready");
    expect(response.status).toBe(200);
    healthResponses.ready[200].parse(response.body);
  });
});
