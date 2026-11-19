import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  construct: vi.fn(),
  env: { stripeSecretKey: undefined as string | undefined },
}));

vi.mock("stripe", () => ({
  default: class {
    webhooks = { constructEvent: vi.fn() };

    constructor(key: string, options: unknown) {
      hoisted.construct(key, options);
    }
  },
}));

vi.mock("../../config/env.js", () => ({ env: hoisted.env }));

const loadClient = async () => {
  vi.resetModules();
  return import("./stripe.client.js");
};

describe("stripe client", () => {
  beforeEach(() => {
    hoisted.construct.mockClear();
    hoisted.env.stripeSecretKey = undefined;
  });

  it("does not construct the SDK client when the module is imported", async () => {
    hoisted.env.stripeSecretKey = "sk_test_x";

    await loadClient();

    expect(hoisted.construct).not.toHaveBeenCalled();
  });

  it("does not throw on import when the key is missing", async () => {
    await expect(loadClient()).resolves.toBeDefined();
    expect(hoisted.construct).not.toHaveBeenCalled();
  });

  it("fails with a clear error at call time when the key is missing", async () => {
    const { stripe } = await loadClient();

    expect(() => stripe.webhooks).toThrow(
      "STRIPE_SECRET_KEY is missing from the environment.",
    );
    expect(hoisted.construct).not.toHaveBeenCalled();
  });

  it("rejects an empty key instead of falling back to an empty string", async () => {
    hoisted.env.stripeSecretKey = "";
    const { stripe } = await loadClient();

    expect(() => stripe.webhooks).toThrow(/STRIPE_SECRET_KEY/);
    expect(hoisted.construct).not.toHaveBeenCalled();
  });

  it("constructs once with the configured key and the request timeout on first use", async () => {
    hoisted.env.stripeSecretKey = "sk_test_x";
    const { stripe } = await loadClient();

    void stripe.webhooks;
    void stripe.webhooks;

    expect(hoisted.construct).toHaveBeenCalledTimes(1);
    expect(hoisted.construct).toHaveBeenCalledWith("sk_test_x", {
      timeout: 30_000,
    });
  });
});
