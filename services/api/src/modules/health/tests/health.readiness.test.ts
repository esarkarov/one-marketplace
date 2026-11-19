import type { Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ping: vi.fn(),
  redis: {
    isOpen: true,
    isReady: true,
    ping: vi.fn(),
  },
  warn: vi.fn(),
}));

vi.mock("@/modules/health/repositories/health.repository.js", () => ({
  pingDatabase: mocks.ping,
}));

vi.mock("@/infrastructure/cache/redis.client.js", () => ({
  redis: mocks.redis,
}));

const { readinessHandler } =
  await import("@/modules/health/controllers/health.controller.js");

const run = async () => {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const request = {
    requestId: "req_1",
    logger: { warn: mocks.warn },
  } as unknown as Request;
  const response = { status } as unknown as Response;
  const pending = readinessHandler(request, response);
  return { pending, status, json };
};

beforeEach(() => {
  mocks.ping.mockReset();
  mocks.ping.mockResolvedValue(undefined);
  mocks.redis.isOpen = true;
  mocks.redis.isReady = true;
  mocks.redis.ping.mockReset();
  mocks.redis.ping.mockResolvedValue("PONG");
  mocks.warn.mockReset();
  mocks.warn.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("readiness handler", () => {
  it("answers 200 ready when both checks pass", async () => {
    const { pending, status, json } = await run();
    await pending;

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({
      success: true,
      message: "Service is ready",
      data: { status: "ready", checks: { postgres: "ok", redis: "ok" } },
    });
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it("answers 503 and logs the failure when Redis is not open", async () => {
    mocks.redis.isOpen = false;

    const { pending, status, json } = await run();
    await pending;

    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: "Service is not ready",
      data: {
        status: "not_ready",
        checks: { postgres: "ok", redis: "failed" },
      },
      code: "SERVICE_UNAVAILABLE",
      requestId: "req_1",
    });
    expect(mocks.redis.ping).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledTimes(1);
    expect(mocks.warn).toHaveBeenCalledWith({
      message: "Readiness check failed",
      eventName: "system.readiness.failed",
      attributes: expect.objectContaining({ "readiness.check": "redis" }),
    });
  });

  it("answers 503 when Redis is open but not ready", async () => {
    mocks.redis.isReady = false;

    const { pending, status, json } = await run();
    await pending;

    expect(status).toHaveBeenCalledWith(503);
    expect(json.mock.calls[0]![0].data.checks).toEqual({
      postgres: "ok",
      redis: "failed",
    });
  });

  it("answers 503 when the Redis ping rejects", async () => {
    mocks.redis.ping.mockRejectedValue(new Error("redis down"));

    const { pending, status, json } = await run();
    await pending;

    expect(status).toHaveBeenCalledWith(503);
    expect(json.mock.calls[0]![0].data.checks.redis).toBe("failed");
  });

  it("answers 503 and logs the failure when the database ping rejects", async () => {
    mocks.ping.mockRejectedValue(new Error("db down"));

    const { pending, status, json } = await run();
    await pending;

    expect(status).toHaveBeenCalledWith(503);
    expect(json.mock.calls[0]![0].data.checks).toEqual({
      postgres: "failed",
      redis: "ok",
    });
    expect(mocks.warn).toHaveBeenCalledTimes(1);
    expect(mocks.warn.mock.calls[0]![0].attributes["readiness.check"]).toBe(
      "postgres",
    );
  });

  it("logs one warning per failed check", async () => {
    mocks.ping.mockRejectedValue(new Error("db down"));
    mocks.redis.isOpen = false;

    const { pending } = await run();
    await pending;

    expect(mocks.warn).toHaveBeenCalledTimes(2);
  });

  it("does not fail the response when the failure log throws", async () => {
    mocks.ping.mockRejectedValue(new Error("db down"));
    mocks.warn.mockRejectedValue(new Error("log down"));

    const { pending, status } = await run();
    await pending;

    expect(status).toHaveBeenCalledWith(503);
  });

  it("fails a check that does not answer within two seconds", async () => {
    vi.useFakeTimers();
    mocks.ping.mockReturnValue(new Promise(() => undefined));

    const { pending, status, json } = await run();
    await vi.advanceTimersByTimeAsync(2_000);
    await pending;

    expect(status).toHaveBeenCalledWith(503);
    expect(json.mock.calls[0]![0].data.checks.postgres).toBe("failed");
    expect(mocks.warn.mock.calls[0]![0].attributes).toMatchObject({
      "readiness.check": "postgres",
    });
  });
});
