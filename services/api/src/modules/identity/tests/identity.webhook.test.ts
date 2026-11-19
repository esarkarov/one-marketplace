import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  warn: vi.fn(),
  completeIdentityVerification: vi.fn(),
  env: { stripeIdentityWebhookSecret: "whsec_identity" as string | undefined },
}));

vi.mock("../../../config/env.js", () => ({ env: mocks.env }));

vi.mock("../../../infrastructure/payments/stripe.client.js", () => ({
  stripe: { webhooks: { constructEvent: mocks.constructEvent } },
}));

vi.mock("../services/identity.service.js", () => ({
  completeIdentityVerification: mocks.completeIdentityVerification,
  createIdentitySession: vi.fn(),
}));

const { identityWebhook } =
  await import("../controllers/identity.controller.js");
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
app.post("/webhook", express.raw({ type: "*/*" }), identityWebhook);
app.use(errorHandler);

const post = (signature?: string) => {
  const call = request(app)
    .post("/webhook")
    .set("content-type", "application/json");
  return (signature ? call.set("stripe-signature", signature) : call).send(
    '{"ok":true}',
  );
};

describe("identity webhook signature verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.env.stripeIdentityWebhookSecret = "whsec_identity";
  });

  it("rejects a missing signature header with the identity-specific message", async () => {
    const response = await post();

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      message: "Invalid Stripe Identity webhook.",
      code: "BAD_REQUEST",
      requestId: expect.any(String),
    });
    expect(mocks.warn).toHaveBeenCalledOnce();
    expect(mocks.warn).toHaveBeenCalledWith({
      message: "Webhook signature rejected",
      eventName: "webhook.inbound.rejected",
      attributes: {
        "webhook.source": "stripe_identity",
        "webhook.reject_reason": "missing_signature_or_secret",
      },
    });
    expect(mocks.constructEvent).not.toHaveBeenCalled();
  });

  it("rejects a missing secret with the same message and log", async () => {
    mocks.env.stripeIdentityWebhookSecret = undefined;

    const response = await post("sig");

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Invalid Stripe Identity webhook.");
    expect(mocks.warn).toHaveBeenCalledWith({
      message: "Webhook signature rejected",
      eventName: "webhook.inbound.rejected",
      attributes: {
        "webhook.source": "stripe_identity",
        "webhook.reject_reason": "missing_signature_or_secret",
      },
    });
    expect(mocks.constructEvent).not.toHaveBeenCalled();
  });

  it("rejects an invalid signature with the shared signature message", async () => {
    mocks.constructEvent.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature");
    });

    const response = await post("bad");

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
        "webhook.source": "stripe_identity",
        "webhook.reject_reason": "invalid_signature",
      },
    });
    expect(mocks.completeIdentityVerification).not.toHaveBeenCalled();
  });

  it("verifies against the raw body, header and identity secret, then handles a verified session", async () => {
    const session = { id: "vs_1" };
    mocks.constructEvent.mockReturnValue({
      type: "identity.verification_session.verified",
      data: { object: session },
    });

    const response = await post("good");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true });
    expect(mocks.constructEvent).toHaveBeenCalledWith(
      Buffer.from('{"ok":true}'),
      "good",
      "whsec_identity",
    );
    expect(mocks.completeIdentityVerification).toHaveBeenCalledWith(session);
  });
});
