import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  warn: vi.fn(),
  complete: vi.fn(),
}));

vi.mock("../../../config/env.js", () => ({
  env: { stripeConnectsWebhookSecret: "whsec_test" },
}));

vi.mock("../../../infrastructure/payments/stripe.client.js", () => ({
  stripe: { webhooks: { constructEvent: mocks.constructEvent } },
}));

vi.mock("../../../middleware/auth/role-guards.middleware.js", () => ({
  requireFreelancer: vi.fn(),
}));

vi.mock("../services/connects.service.js", () => ({
  completeAgencyConnectsPurchase: mocks.complete,
  completeConnectsPurchase: mocks.complete,
  createConnectsCheckout: vi.fn(),
  getConnectsHistory: vi.fn(),
}));

const { connectsWebhook } =
  await import("../controllers/connects.controller.js");
const { errorHandler } =
  await import("../../../middleware/error/error.middleware.js");

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
      code: "BAD_REQUEST",
      requestId: expect.any(String),
    });
    expect(mocks.warn).toHaveBeenCalledOnce();
    expect(mocks.warn).toHaveBeenCalledWith({
      message: "Webhook signature rejected",
      eventName: "webhook.inbound.rejected",
      attributes: {
        "webhook.source": "stripe",
        "webhook.reject_reason": "invalid_signature",
      },
    });
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("answers 400 when the signature header is missing", async () => {
    const response = await request(app)
      .post("/webhook")
      .set("content-type", "application/json")
      .send("{}");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      message: "Invalid Stripe webhook.",
      code: "BAD_REQUEST",
      requestId: expect.any(String),
    });
    expect(mocks.warn).toHaveBeenCalledOnce();
    expect(mocks.warn).toHaveBeenCalledWith({
      message: "Webhook signature rejected",
      eventName: "webhook.inbound.rejected",
      attributes: {
        "webhook.source": "stripe",
        "webhook.reject_reason": "missing_signature_or_secret",
      },
    });
    expect(mocks.constructEvent).not.toHaveBeenCalled();
  });

  it("verifies against the raw body, header and connects secret", async () => {
    mocks.constructEvent.mockReturnValue({
      type: "payment_intent.created",
      data: { object: {} },
    });

    const response = await request(app)
      .post("/webhook")
      .set("stripe-signature", "good")
      .set("content-type", "application/json")
      .send("{}");

    expect(response.status).toBe(200);
    expect(mocks.constructEvent).toHaveBeenCalledWith(
      Buffer.from("{}"),
      "good",
      "whsec_test",
    );
  });
});
