import { createHmac } from "node:crypto";
import http from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const fakeLogger = vi.hoisted(() => ({
  send: async () => {},
  trace: async () => {},
  debug: async () => {},
  info: async () => {},
  warn: async () => {},
  warning: async () => {},
  error: async () => {},
  fatal: async () => {},
}));

vi.mock("@oneminutelogs/express", () => ({
  createLogger: () => fakeLogger,
  withOneMinuteLogs:
    () => (req: { logger: unknown }, _res: unknown, next: () => void) => {
      req.logger = fakeLogger;
      next();
    },
  getStream: () => {
    let release: () => void = () => {};
    const closed = new Promise<void>((resolve) => {
      release = resolve;
    });

    return {
      close: () => release(),
      events: (async function* () {
        yield { message: "test event" };
        await closed;
      })(),
    };
  },
}));

vi.mock("../../config/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../config/env.js")>();
  return { env: { ...original.env, oneMinuteLogsApiKey: "test-key" } };
});

const { app } = await import("../../app.js");
const { pool } = await import("../../database/client.js");

let server: Server;
let port: number;

beforeAll(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

describe("admin log stream", () => {
  it("streams events with security and cors headers", async () => {
    const login = await request(`http://127.0.0.1:${port}`)
      .post("/api/v1/admin/auth/login")
      .send({ password: process.env.ADMIN_DASHBOARD_PASSWORD });

    expect(login.status).toBe(200);

    const expiresAt = String(Date.now() + 60_000);
    const signature = createHmac(
      "sha256",
      process.env.ADMIN_SESSION_SECRET ?? "",
    )
      .update(expiresAt)
      .digest("hex");
    const token = `${expiresAt}.${signature}`;

    const result = await new Promise<{
      status: number | undefined;
      headers: http.IncomingHttpHeaders;
      chunk: string;
    }>((resolve, reject) => {
      const req = http.get(
        {
          host: "127.0.0.1",
          port,
          path: "/api/v1/admin/logs/stream",
          headers: {
            Authorization: `Bearer ${token}`,
            Origin: "http://localhost:3004",
          },
        },
        (res) => {
          res.setEncoding("utf8");
          res.once("data", (chunk: string) => {
            resolve({ status: res.statusCode, headers: res.headers, chunk });
            req.destroy();
          });
        },
      );
      req.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code !== "ECONNRESET") reject(error);
      });
    });

    expect(result.status).toBe(200);
    expect(result.headers["content-type"]).toContain("text/event-stream");
    expect(result.headers["x-content-type-options"]).toBe("nosniff");
    expect(result.headers["cross-origin-resource-policy"]).toBe("cross-origin");
    expect(result.headers["access-control-allow-origin"]).toBe(
      "http://localhost:3004",
    );
    expect(result.chunk).toContain("data: ");
  });
});
