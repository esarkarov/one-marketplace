import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: { clerkSecretKey: "sk_test" as string | undefined },
  getUser: vi.fn(),
  warn: vi.fn(async () => undefined),
  findAccountDisplay: vi.fn(),
  updateAccountDisplay: vi.fn(),
  insertAccountIfAbsent: vi.fn(),
  findAccountIdByAuthId: vi.fn(),
}));

vi.mock("../../../config/env.js", () => ({ env: mocks.env }));
vi.mock("../../../config/logger.js", () => ({
  logger: { warn: mocks.warn },
}));
vi.mock("../../../database/client.js", () => ({ db: {} }));
vi.mock("../../../infrastructure/auth/clerk.client.js", () => ({
  clerk: { users: { getUser: mocks.getUser } },
}));
vi.mock("../../../infrastructure/cache/account-auth.cache.js", () => ({
  invalidateAccountAuthCache: async () => undefined,
}));
vi.mock("../repositories/auth.repository.js", () => ({
  findAccountDisplay: mocks.findAccountDisplay,
  updateAccountDisplay: mocks.updateAccountDisplay,
  insertAccountIfAbsent: mocks.insertAccountIfAbsent,
  findAccountIdByAuthId: mocks.findAccountIdByAuthId,
}));

const { syncAccountDisplay } =
  await import("../services/auth.display.service.js");
const { receiveSignup } = await import("../services/auth.service.js");
const { CLERK_DISPLAY_SYNC_TIMEOUT_MS } =
  await import("../constants/auth.constants.js");

const clerkUser = (overrides: Record<string, unknown> = {}) => ({
  firstName: "Ada",
  lastName: "Lovelace",
  fullName: "Ada Lovelace",
  imageUrl: "https://img.test/ada.png",
  primaryEmailAddress: { emailAddress: "ada@example.test" },
  emailAddresses: [],
  ...overrides,
});

const stored = { displayName: "Old Name", avatarUrl: "https://img.test/old" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.clerkSecretKey = "sk_test";
  mocks.findAccountDisplay.mockResolvedValue(stored);
  mocks.getUser.mockResolvedValue(clerkUser());
});

afterEach(() => {
  vi.useRealTimers();
});

describe("syncAccountDisplay", () => {
  it("writes and returns the new values", async () => {
    const result = await syncAccountDisplay("user_1");

    expect(result).toEqual({
      displayName: "Ada Lovelace",
      avatarUrl: "https://img.test/ada.png",
    });
    expect(mocks.updateAccountDisplay).toHaveBeenCalledWith({}, "user_1", {
      displayName: "Ada Lovelace",
      avatarUrl: "https://img.test/ada.png",
    });
    expect(mocks.getUser).toHaveBeenCalledTimes(1);
  });

  it("falls back to fullName, then null, and null avatar", async () => {
    mocks.getUser.mockResolvedValueOnce(
      clerkUser({ firstName: null, lastName: null, imageUrl: "" }),
    );
    expect(await syncAccountDisplay("user_1")).toEqual({
      displayName: "Ada Lovelace",
      avatarUrl: null,
    });

    mocks.getUser.mockResolvedValueOnce(
      clerkUser({ firstName: null, lastName: null, fullName: null }),
    );
    expect((await syncAccountDisplay("user_1")).displayName).toBeNull();
  });

  it("skips the write when nothing changed", async () => {
    mocks.findAccountDisplay.mockResolvedValue({
      displayName: "Ada Lovelace",
      avatarUrl: "https://img.test/ada.png",
    });

    const result = await syncAccountDisplay("user_1");

    expect(result.displayName).toBe("Ada Lovelace");
    expect(mocks.updateAccountDisplay).not.toHaveBeenCalled();
  });

  it("returns the stored values and logs when Clerk fails", async () => {
    mocks.getUser.mockRejectedValue(new Error("clerk down"));

    await expect(syncAccountDisplay("user_1")).resolves.toEqual(stored);

    expect(mocks.updateAccountDisplay).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledTimes(1);
    const payload = JSON.stringify(mocks.warn.mock.calls[0]);
    expect(payload).toContain("account.display_sync.failed");
    expect(payload).not.toContain("user_1");
    expect(payload).not.toContain("clerk down");
  });

  it("returns the stored values when Clerk does not answer in time", async () => {
    vi.useFakeTimers();
    mocks.getUser.mockReturnValue(new Promise(() => undefined));

    const pending = syncAccountDisplay("user_1");
    await vi.advanceTimersByTimeAsync(CLERK_DISPLAY_SYNC_TIMEOUT_MS);

    await expect(pending).resolves.toEqual(stored);
    expect(mocks.updateAccountDisplay).not.toHaveBeenCalled();
  });

  it("returns the stored values without calling Clerk when no key is set", async () => {
    mocks.env.clerkSecretKey = undefined;

    await expect(syncAccountDisplay("user_1")).resolves.toEqual(stored);

    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledTimes(1);
  });

  it("never throws when the database fails", async () => {
    mocks.findAccountDisplay.mockRejectedValue(new Error("db down"));

    await expect(syncAccountDisplay("user_1")).resolves.toEqual({
      displayName: null,
      avatarUrl: null,
    });
  });

  it("returns empty values for an unknown account", async () => {
    mocks.findAccountDisplay.mockResolvedValue(undefined);
    mocks.getUser.mockRejectedValue(new Error("not found"));

    await expect(syncAccountDisplay("ghost")).resolves.toEqual({
      displayName: null,
      avatarUrl: null,
    });
  });
});

describe("receiveSignup display fields", () => {
  const input = {
    userId: "user_1",
    role: "freelancer" as const,
    accountExists: false,
    isOnboarded: false,
  };

  it("stores name and avatar from the same Clerk fetch", async () => {
    await receiveSignup(input);

    expect(mocks.getUser).toHaveBeenCalledTimes(1);
    expect(mocks.insertAccountIfAbsent).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        displayName: "Ada Lovelace",
        avatarUrl: "https://img.test/ada.png",
      }),
    );
  });

  it("keeps a missing name null", async () => {
    mocks.getUser.mockResolvedValue(
      clerkUser({
        firstName: null,
        lastName: null,
        fullName: null,
        imageUrl: "",
      }),
    );

    await receiveSignup(input);

    expect(mocks.insertAccountIfAbsent).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ displayName: null, avatarUrl: null }),
    );
  });
});
