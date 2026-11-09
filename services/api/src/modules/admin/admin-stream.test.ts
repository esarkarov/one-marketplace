import { createHmac } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { app } = await import("../../app.js");
const { pool } = await import("../../database/client.js");

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

const adminToken = () => {
  const expiresAt = String(Date.now() + 60_000);
  const signature = createHmac("sha256", process.env.ADMIN_SESSION_SECRET ?? "")
    .update(expiresAt)
    .digest("hex");
  return `${expiresAt}.${signature}`;
};

describe("admin log stream", () => {
  it("returns 503 for an authenticated admin with security and cors headers", async () => {
    const response = await request(baseUrl)
      .get("/api/v1/admin/logs/stream")
      .set("Authorization", `Bearer ${adminToken()}`)
      .set("Origin", "http://localhost:3004");

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      success: false,
      message: "Internal server error.",
    });
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["cross-origin-resource-policy"]).toBe(
      "cross-origin",
    );
    expect(response.headers["access-control-allow-origin"]).toBe(
      "http://localhost:3004",
    );
  });

  it("rejects unauthenticated requests", async () => {
    const response = await request(baseUrl).get("/api/v1/admin/logs/stream");

    expect(response.status).toBe(401);
  });
});
