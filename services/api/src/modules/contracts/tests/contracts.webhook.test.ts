import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  warn: vi.fn(),
  createContractFromPayment: vi.fn(),
  fundContractMilestoneFromPayment: vi.fn(),
  env: { stripeWebhookSecret: "whsec_contracts" as string | undefined },
}));

vi.mock("@/config/env.js", () => ({ env: mocks.env }));

vi.mock("@/infrastructure/payments/stripe.client.js", () => ({
  stripe: { webhooks: { constructEvent: mocks.constructEvent } },
}));

vi.mock("@/middleware/auth/role-guards.middleware.js", () => ({
  requireClient: vi.fn(),
  requireFreelancer: vi.fn(),
}));

vi.mock("@/modules/agency/index.js", () => ({
  getAgencyIdForMember: vi.fn(),
  requireAgencyPermission: vi.fn(),
}));

vi.mock("@/modules/contracts/services/contracts.checkout.service.js", () => ({
  createContractCheckout: vi.fn(),
  createMilestoneFundingCheckout: vi.fn(),
  fundContractMilestoneFromPayment: mocks.fundContractMilestoneFromPayment,
}));

vi.mock("@/modules/contracts/services/contracts.listing.service.js", () => ({
  getAccountContracts: vi.fn(),
}));

vi.mock("@/modules/contracts/services/contracts.lifecycle.service.js", () => ({
  acceptContract: vi.fn(),
  cancelPendingContract: vi.fn(),
  createContractFromPayment: mocks.createContractFromPayment,
  finishContractWithReview: vi.fn(),
}));

vi.mock("@/modules/contracts/services/contracts.milestones.service.js", () => ({
  addContractMilestone: vi.fn(),
  reviewContractMilestone: vi.fn(),
  submitContractMilestone: vi.fn(),
}));

vi.mock("@/infrastructure/events/notification.publisher.js", () => ({
  sendNotification: vi.fn(),
}));

vi.mock("@/modules/messaging/index.js", () => ({
  emitConversationUpdate: vi.fn(),
}));

const { contractWebhook } =
  await import("@/modules/contracts/controllers/contracts.controller.js");
const { errorHandler } = await import("@/middleware/error/error.middleware.js");
const { currentWebhookEventId } =
  await import("@/modules/contracts/utils/contracts.webhook-context.js");

const app = express();
app.use((req, _res, next) => {
  req.logger = {
    warn: mocks.warn,
    info: async () => undefined,
    error: async () => undefined,
  } as unknown as typeof req.logger;
  next();
});
app.post("/webhook", express.raw({ type: "*/*" }), contractWebhook);
app.use(errorHandler);

const post = (signature?: string) => {
  const call = request(app)
    .post("/webhook")
    .set("content-type", "application/json");
  return (signature ? call.set("stripe-signature", signature) : call).send(
    '{"ok":true}',
  );
};

describe("contract webhook signature verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.env.stripeWebhookSecret = "whsec_contracts";
  });

  it("rejects a missing signature header with the missing-secret log and message", async () => {
    const response = await post();

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

  it("rejects a missing secret with the same message and log", async () => {
    mocks.env.stripeWebhookSecret = undefined;

    const response = await post("sig");

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Invalid Stripe webhook.");
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

  it("rejects an invalid signature with the invalid-signature log and message", async () => {
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
        "webhook.source": "stripe",
        "webhook.reject_reason": "invalid_signature",
      },
    });
    expect(mocks.createContractFromPayment).not.toHaveBeenCalled();
  });

  it("verifies against the raw body, header and webhook secret, then handles the event", async () => {
    const session = { id: "cs_1", metadata: {} };
    mocks.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: { object: session },
    });

    const response = await post("good");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true });
    expect(mocks.constructEvent).toHaveBeenCalledWith(
      Buffer.from('{"ok":true}'),
      "good",
      "whsec_contracts",
    );
    expect(mocks.createContractFromPayment).toHaveBeenCalledWith(session);
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it("routes milestone funding sessions to the funding handler", async () => {
    const session = {
      id: "cs_2",
      metadata: { paymentType: "CONTRACT_MILESTONE_FUNDING" },
    };
    mocks.constructEvent.mockReturnValue({
      type: "checkout.session.async_payment_succeeded",
      data: { object: session },
    });

    const response = await post("good");

    expect(response.status).toBe(200);
    expect(mocks.fundContractMilestoneFromPayment).toHaveBeenCalledWith(
      session,
    );
    expect(mocks.createContractFromPayment).not.toHaveBeenCalled();
  });

  it("routes async payment sessions without a payment type to the contract handler", async () => {
    const session = { id: "cs_3", metadata: { paymentType: "OTHER" } };
    mocks.constructEvent.mockReturnValue({
      type: "checkout.session.async_payment_succeeded",
      data: { object: session },
    });

    const response = await post("good");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true });
    expect(mocks.createContractFromPayment).toHaveBeenCalledWith(session);
    expect(mocks.fundContractMilestoneFromPayment).not.toHaveBeenCalled();
  });

  it("acknowledges other event types without handling them", async () => {
    mocks.constructEvent.mockReturnValue({
      type: "charge.refunded",
      data: { object: { id: "ch_1" } },
    });

    const response = await post("good");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true });
    expect(mocks.createContractFromPayment).not.toHaveBeenCalled();
    expect(mocks.fundContractMilestoneFromPayment).not.toHaveBeenCalled();
  });

  it("answers 500 when the handler fails so Stripe retries", async () => {
    mocks.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: { object: { id: "cs_4", metadata: {} } },
    });
    mocks.createContractFromPayment.mockRejectedValueOnce(new Error("db down"));

    const response = await post("good");

    expect(response.status).toBe(500);
  });

  it("runs the contract handler with the Stripe event id available to the refund logs", async () => {
    let seen: string | undefined;
    mocks.createContractFromPayment.mockImplementationOnce(async () => {
      seen = currentWebhookEventId();
    });
    mocks.constructEvent.mockReturnValue({
      id: "evt_contract",
      type: "checkout.session.completed",
      data: { object: { id: "cs_5", metadata: {} } },
    });

    const response = await post("good");

    expect(response.status).toBe(200);
    expect(seen).toBe("evt_contract");
    expect(currentWebhookEventId()).toBeUndefined();
  });

  it("runs the funding handler with the Stripe event id available to the refund logs", async () => {
    let seen: string | undefined;
    mocks.fundContractMilestoneFromPayment.mockImplementationOnce(async () => {
      seen = currentWebhookEventId();
    });
    mocks.constructEvent.mockReturnValue({
      id: "evt_funding",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_6",
          metadata: { paymentType: "CONTRACT_MILESTONE_FUNDING" },
        },
      },
    });

    const response = await post("good");

    expect(response.status).toBe(200);
    expect(seen).toBe("evt_funding");
  });
});
