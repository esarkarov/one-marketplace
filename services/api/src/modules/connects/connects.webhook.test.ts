import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  warn: vi.fn(),
  complete: vi.fn(),
}));

vi.mock("../../config/env.js", () => ({
  env: { stripeConnectsWebhookSecret: "whsec_test" },
}));

vi.mock("../../infrastructure/stripe.js", () => ({
  stripe: { webhooks: { constructEvent: mocks.constructEvent } },
}));

vi.mock("../../shared/http/auth/role-guards.js", () => ({
  requireFreelancer: vi.fn(),
}));

vi.mock("./connects.service.js", () => ({
  completeAgencyConnectsPurchase: mocks.complete,
  completeConnectsPurchase: mocks.complete,
  createConnectsCheckout: vi.fn(),
  getConnectsHistory: vi.fn(),
}));

const { connectsWebhook } = await import("./connects.controller.js");
const { errorHandler } =
  await import("../../app-middleware/error.middleware.js");

const app = express();
app.use((req, _res, next) => {
  req.logger = {
    warn: mocks.warn,
    info: async () => undefined,
    error: async () => undefined,
  } as unknown as typeof req.logger;
  next();
});
app.post("/webhook", express.raw({ type: "*/*" }), connectsWebhook);
app.use(errorHandler);

describe("connects webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("answers 400 without internals on a bad signature", async () => {
    mocks.constructEvent.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature");
    });

    const response = await request(app)
      .post("/webhook")
      .set("stripe-signature", "bad")
      .set("content-type", "application/json")
      .send("{}");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      message: "Invalid Stripe webhook signature.",
    });
    expect(mocks.warn).toHaveBeenCalledOnce();
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("answers 400 when the signature header is missing", async () => {
    const response = await request(app)
      .post("/webhook")
      .set("content-type", "application/json")
      .send("{}");

    expect(response.status).toBe(400);
    expect(mocks.constructEvent).not.toHaveBeenCalled();
  });
});
