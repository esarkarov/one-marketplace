import { afterEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  error: vi.fn(),
}));

vi.mock("@/config/logger.js", () => ({
  logger: {
    info: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn().mockResolvedValue(undefined),
    error: hoisted.error,
    fatal: vi.fn().mockResolvedValue(undefined),
  },
  rootLogger: { flush: (done: () => void) => done() },
}));

const { pool } = await import("./client.js");
const constants = await import("./database.constants.js");

describe("database pool", () => {
  afterEach(() => {
    hoisted.error.mockReset();
    vi.restoreAllMocks();
  });

  it("has an error listener so an idle client failure is not an uncaught exception", () => {
    expect(pool.listenerCount("error")).toBeGreaterThan(0);
  });

  it("logs a pool error without throwing or exiting the process", () => {
    hoisted.error.mockResolvedValue(undefined);
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    const failure = new Error(
      "terminating connection postgres://app:s3cret-pw@db.internal:5432/app",
    );

    expect(() => pool.emit("error", failure)).not.toThrow();

    expect(exit).not.toHaveBeenCalled();
    expect(hoisted.error).toHaveBeenCalledTimes(1);
    const payload = hoisted.error.mock.calls[0]![0];
    expect(payload.eventName).toBe("database.pool.error");
    expect(Object.keys(payload.attributes)).toEqual(["error.message"]);
    expect(JSON.stringify(payload)).not.toContain("s3cret-pw");
  });

  it("does not throw when the logger itself rejects", async () => {
    hoisted.error.mockRejectedValue(new Error("log sink down"));

    expect(() => pool.emit("error", new Error("boom"))).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });

  it("applies the named limits to the pool configuration", () => {
    const options = pool.options as unknown as Record<string, unknown>;

    expect(options.max).toBe(constants.POOL_MAX_CLIENTS);
    expect(options.connectionTimeoutMillis).toBe(
      constants.POOL_CONNECTION_TIMEOUT_MS,
    );
    expect(options.idleTimeoutMillis).toBe(constants.POOL_IDLE_TIMEOUT_MS);
    expect(options.statement_timeout).toBe(constants.POOL_STATEMENT_TIMEOUT_MS);
    expect(options.idle_in_transaction_session_timeout).toBe(
      constants.POOL_IDLE_IN_TRANSACTION_TIMEOUT_MS,
    );
  });

  it("uses the agreed limit values", () => {
    expect(constants.POOL_MAX_CLIENTS).toBe(10);
    expect(constants.POOL_CONNECTION_TIMEOUT_MS).toBe(10_000);
    expect(constants.POOL_IDLE_TIMEOUT_MS).toBe(30_000);
    expect(constants.POOL_STATEMENT_TIMEOUT_MS).toBe(60_000);
    expect(constants.POOL_IDLE_IN_TRANSACTION_TIMEOUT_MS).toBe(60_000);
  });
});
