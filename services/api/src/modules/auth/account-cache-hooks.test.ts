import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  events: [] as string[],
  returning: [] as unknown[][],
  failInsert: false,
  getUser: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock("@clerk/backend", () => ({
  createClerkClient: () => ({ users: { getUser: mocks.getUser } }),
}));

vi.mock("../../config/env.js", () => ({
  env: { clerkSecretKey: "sk_test", imageKitPrivateKey: "ik_test" },
}));

vi.mock("../../config/logger.js", () => ({
  logger: { error: async () => undefined, warn: async () => undefined },
}));

vi.mock("../../infrastructure/stripe.js", () => ({ stripe: {} }));
vi.mock("../../infrastructure/image-kit.js", () => ({ imageKit: {} }));
vi.mock("../agency/agency.service.js", () => ({
  getAgencyIdentityForMember: vi.fn(),
}));
vi.mock("../connects/connects.service.js", () => ({
  addConnects: vi.fn(),
}));

vi.mock("../../infrastructure/account-auth-cache.js", () => ({
  invalidateAccountAuthCache: async (userId: string) => {
    mocks.events.push("invalidate");
    mocks.invalidate(userId);
  },
}));

vi.mock("../../database/client.js", () => {
  const chain: Record<string, unknown> = {};
  for (const method of [
    "select",
    "from",
    "innerJoin",
    "where",
    "update",
    "set",
    "insert",
    "values",
    "onConflictDoUpdate",
    "delete",
  ]) {
    chain[method] = () => chain;
  }
  chain.then = (resolve: (value: unknown) => void) => resolve([]);
  chain.returning = async () => mocks.returning.shift() ?? [];
  chain.onConflictDoNothing = async () => {
    mocks.events.push("insert");
    if (mocks.failInsert) throw new Error("insert failed");
  };
  return {
    db: {
      ...chain,
      transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
        mocks.events.push("tx:start");
        const result = await callback(chain);
        mocks.events.push("tx:commit");
        return result;
      },
    },
  };
});

const { receiveSignup } = await import("./auth.service.js");
const { saveClientProfile } = await import("../client/client.service.js");
const { saveFreelancerProfile } =
  await import("../freelancer/freelancer.service.js");

beforeEach(() => {
  mocks.events.length = 0;
  mocks.returning.length = 0;
  mocks.failInsert = false;
  mocks.invalidate.mockReset();
  mocks.getUser.mockReset();
  mocks.getUser.mockResolvedValue({
    primaryEmailAddress: { emailAddress: "user@example.com" },
    emailAddresses: [],
  });
});

describe("receiveSignup", () => {
  const input = {
    userId: "user_1",
    role: "client" as const,
    accountExists: false,
    isOnboarded: false,
  };

  it("invalidates the auth cache after the account is inserted", async () => {
    await receiveSignup(input);

    expect(mocks.events).toEqual(["insert", "invalidate"]);
    expect(mocks.invalidate).toHaveBeenCalledWith("user_1");
  });

  it("does not invalidate when the insert fails", async () => {
    mocks.failInsert = true;

    await expect(receiveSignup(input)).rejects.toThrow("insert failed");

    expect(mocks.invalidate).not.toHaveBeenCalled();
  });

  it("does not touch the cache when the account already exists", async () => {
    await receiveSignup({ ...input, accountExists: true });

    expect(mocks.events).toEqual([]);
  });
});

describe("saveClientProfile", () => {
  const input = {
    userId: "user_1",
    professionalRole: "CTO",
    companyName: "Acme",
    companyWebsite: "https://acme.test",
    companySize: "1-10",
    industry: "Software",
    companyDescription: "Builds things",
  };

  it("invalidates the auth cache after the transaction commits", async () => {
    mocks.returning.push(
      [{ id: "a1", identityVerified: false, paymentMethodVerified: false }],
      [{ professionalRole: "CTO", companyName: "Acme" }],
    );

    const profile = await saveClientProfile(input);

    expect(mocks.events).toEqual(["tx:start", "tx:commit", "invalidate"]);
    expect(mocks.invalidate).toHaveBeenCalledWith("user_1");
    expect(profile.isOnboarded).toBe(true);
  });

  it("does not invalidate when the transaction fails", async () => {
    mocks.returning.push([]);

    await expect(saveClientProfile(input)).rejects.toThrow(
      "Client account not found.",
    );

    expect(mocks.events).toEqual(["tx:start"]);
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });
});

describe("saveFreelancerProfile", () => {
  const input = {
    userId: "user_1",
    professional_title: "Engineer",
    professional_description: "Builds things",
    hourly_rate_cents: 5000,
    country: "US",
    city: "Austin",
    availability_status: "available",
    weekly_availability: 20,
    experience_level: "expert",
    skills: ["ts"],
    languages: [],
    portfolios: [],
  } as never;

  it("invalidates the auth cache after the transaction commits", async () => {
    mocks.returning.push(
      [{ id: "a1", identityVerified: false }],
      [{ id: "m1", created_at: new Date() }],
      [],
    );

    await saveFreelancerProfile(input, true);

    expect(mocks.events).toEqual(["tx:start", "tx:commit", "invalidate"]);
    expect(mocks.invalidate).toHaveBeenCalledWith("user_1");
  });

  it("does not invalidate when the transaction fails", async () => {
    mocks.returning.push([]);

    await expect(saveFreelancerProfile(input, true)).rejects.toThrow(
      "Freelancer account not found.",
    );

    expect(mocks.events).toEqual(["tx:start"]);
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });
});
