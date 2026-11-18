import { EventEmitter } from "node:events";
import type { Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SSE_SHUTDOWN_FRAME } from "../constants/sse-streams.constants.js";

class FakeResponse extends EventEmitter {
  writableEnded = false;
  headers: Record<string, string> = {};
  write = vi.fn();
  end = vi.fn(() => {
    this.writableEnded = true;
  });
  set = vi.fn((name: string, value: string) => {
    this.headers[name] = value;
  });
}

const fake = () => new FakeResponse();
const asResponse = (value: FakeResponse) => value as unknown as Response;

describe("sse stream registry", () => {
  let registry: typeof import("./sse-streams.utils.js");

  beforeEach(async () => {
    vi.resetModules();
    registry = await import("./sse-streams.utils.js");
  });

  it("registers and unregisters a stream", () => {
    const response = fake();
    const unregister = registry.registerSseStream(asResponse(response));
    expect(registry.openSseStreamCount()).toBe(1);
    unregister();
    expect(registry.openSseStreamCount()).toBe(0);
  });

  it("unregisters on close and on finish", () => {
    const closed = fake();
    const finished = fake();
    registry.registerSseStream(asResponse(closed));
    registry.registerSseStream(asResponse(finished));
    closed.emit("close");
    expect(registry.openSseStreamCount()).toBe(1);
    finished.emit("finish");
    expect(registry.openSseStreamCount()).toBe(0);
  });

  it("writes the shutdown frame with retry and ends every stream", () => {
    const first = fake();
    const second = fake();
    registry.registerSseStream(asResponse(first));
    registry.registerSseStream(asResponse(second));

    registry.closeAllSseStreams();

    for (const response of [first, second]) {
      expect(response.write).toHaveBeenCalledWith(SSE_SHUTDOWN_FRAME);
      expect(response.end).toHaveBeenCalledTimes(1);
    }
    expect(SSE_SHUTDOWN_FRAME).toBe(
      "retry: 1000\nevent: shutdown\ndata: {}\n\n",
    );
    expect(registry.openSseStreamCount()).toBe(0);
  });

  it("keeps closing the others when one stream throws", () => {
    const dead = fake();
    dead.write.mockImplementation(() => {
      throw new Error("write after end");
    });
    const alive = fake();
    registry.registerSseStream(asResponse(dead));
    registry.registerSseStream(asResponse(alive));

    expect(() => registry.closeAllSseStreams()).not.toThrow();
    expect(alive.write).toHaveBeenCalledWith(SSE_SHUTDOWN_FRAME);
    expect(alive.end).toHaveBeenCalledTimes(1);
  });

  it("is safe to close twice without writing again", () => {
    const response = fake();
    registry.registerSseStream(asResponse(response));
    registry.closeAllSseStreams();
    registry.closeAllSseStreams();
    expect(response.write).toHaveBeenCalledTimes(1);
    expect(response.end).toHaveBeenCalledTimes(1);
  });

  it("leaves nothing registered after a normal close", () => {
    const response = fake();
    registry.registerSseStream(asResponse(response));
    response.emit("close");
    registry.closeAllSseStreams();
    expect(response.write).not.toHaveBeenCalled();
    expect(registry.openSseStreamCount()).toBe(0);
  });

  it("answers 503 with Retry-After only after close-all", () => {
    const before = fake();
    expect(() => registry.assertSseAvailable(asResponse(before))).not.toThrow();

    registry.closeAllSseStreams();

    const after = fake();
    expect(() => registry.assertSseAvailable(asResponse(after))).toThrow(
      expect.objectContaining({ statusCode: 503 }),
    );
    expect(after.headers["Retry-After"]).toBe("1");
  });
});
