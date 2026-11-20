import { beforeEach, describe, expect, it, vi } from "vitest";

const logs = vi.hoisted(() => ({ debug: vi.fn() }));

vi.mock("@/config/logger.js", () => ({
  logger: { debug: logs.debug },
}));

import {
  pushStoredNotification,
  registerNotificationPusher,
} from "@/modules/notification-store/services/notification-store.push.service.js";
import type { NotificationRow } from "@/modules/notification-store/types/notification-store.types.js";

const row = { id: "n1", event_id: "e1" } as NotificationRow;

describe("notification pusher registry", () => {
  beforeEach(() => {
    registerNotificationPusher(null);
    logs.debug.mockReset().mockResolvedValue(undefined);
  });

  it("hands the row to the registered pusher", async () => {
    const pusher = vi.fn().mockResolvedValue(undefined);
    registerNotificationPusher(pusher);

    await pushStoredNotification(row);

    expect(pusher).toHaveBeenCalledTimes(1);
    expect(pusher).toHaveBeenCalledWith(row);
  });

  it("is a no-op with a debug log when no pusher is registered", async () => {
    await expect(pushStoredNotification(row)).resolves.toBeUndefined();

    expect(logs.debug).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "notifications.push.no_pusher" }),
    );
  });

  it("never throws when the pusher rejects or throws", async () => {
    registerNotificationPusher(() => Promise.reject(new Error("down")));
    await expect(pushStoredNotification(row)).resolves.toBeUndefined();

    registerNotificationPusher(() => {
      throw new Error("sync");
    });
    await expect(pushStoredNotification(row)).resolves.toBeUndefined();
  });

  it("stops pushing after the pusher is cleared", async () => {
    const pusher = vi.fn().mockResolvedValue(undefined);
    registerNotificationPusher(pusher);
    registerNotificationPusher(null);

    await pushStoredNotification(row);

    expect(pusher).not.toHaveBeenCalled();
  });
});
