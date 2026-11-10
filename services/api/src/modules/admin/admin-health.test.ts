import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ping: vi.fn(),
  execute: vi.fn(),
  rabbit: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("../../config/redis.js", () => ({ redis: { ping: mocks.ping } }));
vi.mock("../../config/rabbitmq.js", () => ({ getRabbitStatus: mocks.rabbit }));
vi.mock("../../config/logger.js", () => ({
  logger: { error: mocks.logError },
}));
vi.mock("../../database/client.js", () => ({
  db: { execute: mocks.execute },
  pool: { end: async () => undefined },
}));

const { getSystemHealth } = await import("./admin.service.js");

beforeEach(() => {
  vi.resetAllMocks();
  mocks.ping.mockResolvedValue("PONG");
  mocks.execute.mockResolvedValue([]);
  mocks.rabbit.mockResolvedValue({ ok: true });
});

describe("getSystemHealth", () => {
  it("reports rabbitmq status", async () => {
    mocks.rabbit.mockResolvedValue({ ok: true, latencyMs: 3 });

    const health = await getSystemHealth();

    expect(health.rabbitmq).toEqual({ ok: true, latencyMs: 3 });
    expect(health.redis.ok).toBe(true);
    expect(health.database.ok).toBe(true);
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("reports only ok false when rabbitmq is down", async () => {
    mocks.rabbit.mockResolvedValue({ ok: false });

    expect((await getSystemHealth()).rabbitmq).toEqual({ ok: false });
  });

  it("does not leak error text when the status check rejects", async () => {
    mocks.rabbit.mockRejectedValue(new Error("amqp://u:secret@h"));

    const health = await getSystemHealth();

    expect(health.rabbitmq).toEqual({ ok: false });
    expect(JSON.stringify(health.rabbitmq)).not.toContain("secret");
  });

  it("returns only ok false when redis fails and logs server-side", async () => {
    mocks.ping.mockRejectedValue(new Error("redis://u:secret@h refused"));

    const health = await getSystemHealth();

    expect(health.redis).toEqual({ ok: false });
    expect("error" in health.redis).toBe(false);
    expect(JSON.stringify(health)).not.toContain("secret");
    expect(health.database.ok).toBe(true);
    expect(mocks.logError).toHaveBeenCalledTimes(1);
    expect(mocks.logError.mock.calls[0]![0].eventName).toBe(
      "admin.health.redis_failed",
    );
    expect(JSON.stringify(mocks.logError.mock.calls[0]![0])).not.toContain(
      "secret",
    );
  });

  it("returns only ok false when the database fails and logs server-side", async () => {
    mocks.execute.mockRejectedValue(new Error("postgres://u:secret@h down"));

    const health = await getSystemHealth();

    expect(health.database).toEqual({ ok: false });
    expect("error" in health.database).toBe(false);
    expect(JSON.stringify(health)).not.toContain("secret");
    expect(mocks.logError).toHaveBeenCalledTimes(1);
    expect(mocks.logError.mock.calls[0]![0].eventName).toBe(
      "admin.health.database_failed",
    );
  });

  it("still returns ok false when the logger rejects", async () => {
    mocks.ping.mockRejectedValue(new Error("down"));
    mocks.logError.mockRejectedValue(new Error("log sink down"));

    expect((await getSystemHealth()).redis).toEqual({ ok: false });
  });
});
