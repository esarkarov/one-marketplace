import { EventEmitter } from "node:events";
import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../agency/index.js", () => ({
  getAgencyIdForMember: vi.fn().mockResolvedValue("agency-1"),
}));
vi.mock("../services/notifications.service.js", () => ({
  getNotifications: vi.fn(),
  readAllNotifications: vi.fn(),
  readNotification: vi.fn(),
}));

class FakeResponse extends EventEmitter {
  writableEnded = false;
  headers: Record<string, string> = {};
  write = vi.fn();
  end = vi.fn(() => {
    this.writableEnded = true;
  });
  flushHeaders = vi.fn();
  set = vi.fn((value: string | Record<string, string>, header?: string) => {
    if (typeof value === "string") {
      this.headers[value] = header ?? "";
    } else {
      Object.assign(this.headers, value);
    }
  });
}

const open = (scope: string | undefined) => {
  const request = Object.assign(new EventEmitter(), {
    query: scope ? { scope } : {},
    validated: { query: scope ? { scope } : {} },
    auth: { userId: "user-1" },
  });
  const response = new FakeResponse();
  return { request, response };
};

describe("notification stream registration", () => {
  let registry: typeof import("../../../middleware/utils/sse-streams.utils.js");
  let notificationStream: typeof import("../controllers/notifications.controller.js").notificationStream;

  beforeEach(async () => {
    vi.resetModules();
    registry = await import("../../../middleware/utils/sse-streams.utils.js");
    ({ notificationStream } =
      await import("../controllers/notifications.controller.js"));
  });

  const start = async (scope?: string) => {
    const { request, response } = open(scope);
    await notificationStream(
      request as unknown as Request,
      response as unknown as Response,
      vi.fn(),
    );
    return { request, response };
  };

  it.each([[undefined], ["agency"]])(
    "registers on open and unregisters on disconnect (scope %s)",
    async (scope) => {
      const { request, response } = await start(scope);
      expect(response.write).toHaveBeenCalledWith(
        "event: connected\ndata: {}\n\n",
      );
      expect(registry.openSseStreamCount()).toBe(1);

      request.emit("close");
      response.emit("close");
      expect(registry.openSseStreamCount()).toBe(0);
    },
  );

  it("ends an open stream with the shutdown event", async () => {
    const { response } = await start();
    registry.closeAllSseStreams();
    expect(response.write).toHaveBeenLastCalledWith(
      "retry: 1000\nevent: shutdown\ndata: {}\n\n",
    );
    expect(response.end).toHaveBeenCalledTimes(1);
  });

  it("rejects a new stream with 503 and Retry-After after close-all", async () => {
    registry.closeAllSseStreams();
    const { request, response } = open(undefined);

    await expect(
      notificationStream(
        request as unknown as Request,
        response as unknown as Response,
        vi.fn(),
      ),
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(response.headers["Retry-After"]).toBe("1");
    expect(response.flushHeaders).not.toHaveBeenCalled();
    expect(registry.openSseStreamCount()).toBe(0);
  });
});
