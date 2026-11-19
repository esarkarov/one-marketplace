import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  completeFreelancer: vi.fn(),
  completeAgency: vi.fn(),
}));

vi.mock("@/config/env.js", () => ({
  env: { stripeConnectsWebhookSecret: "whsec_test" },
}));

vi.mock("@/infrastructure/payments/stripe.client.js", () => ({
  stripe: { webhooks: { constructEvent: mocks.constructEvent } },
}));

vi.mock("@/middleware/auth/role-guards.middleware.js", () => ({
  requireFreelancer: vi.fn(),
}));

vi.mock("@/modules/connects/services/connects.service.js", () => ({
  completeAgencyConnectsPurchase: mocks.completeAgency,
  completeConnectsPurchase: mocks.completeFreelancer,
  createConnectsCheckout: vi.fn(),
  getConnectsHistory: vi.fn(),
}));

const { connectsWebhook } =
  await import("@/modules/connects/controllers/connects.controller.js");
const { errorHandler } = await import("@/middleware/error/error.middleware.js");
const { CONNECTS_PLANS } =
  await import("@/modules/connects/constants/connects.constants.js");

const app = express();
app.use((req, _res, next) => {
  req.logger = {
    warn: mocks.warn,
    info: mocks.info,
    error: async () => undefined,
  } as unknown as typeof req.logger;
  next();
});
app.post("/webhook", express.raw({ type: "*/*" }), connectsWebhook);
app.use(errorHandler);

const [PLAN] = Object.keys(CONNECTS_PLANS).map(Number) as [number];

const deliver = (event: unknown) => {
  mocks.constructEvent.mockReturnValue(event);
  return request(app)
    .post("/webhook")
    .set("content-type", "application/json")
    .set("stripe-signature", "good")
    .send("{}");
};

const completed = (
  session: Record<string, unknown>,
  type = "checkout.session.completed",
) => ({ type, data: { object: { id: "cs_1", ...session } } });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.warn.mockResolvedValue(undefined);
  mocks.info.mockResolvedValue(undefined);
  mocks.completeFreelancer.mockResolvedValue(undefined);
  mocks.completeAgency.mockResolvedValue(undefined);
});

describe("connects webhook events", () => {
  it("credits a freelancer purchase, then logs the payment", async () => {
    const response = await deliver(
      completed({
        payment_status: "paid",
        metadata: { purchasedConnects: String(PLAN), freelancerId: "frl_1" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true });
    expect(mocks.completeFreelancer).toHaveBeenCalledWith(
      "frl_1",
      PLAN,
      "cs_1",
    );
    expect(mocks.completeAgency).not.toHaveBeenCalled();
    expect(mocks.info).toHaveBeenCalledTimes(1);
    expect(mocks.info).toHaveBeenCalledWith({
      message: "Payment succeeded",
      eventName: "payment.charge.succeeded",
      attributes: {
        "payment.provider": "stripe",
        "payment.amount_cents":
          CONNECTS_PLANS[PLAN as keyof typeof CONNECTS_PLANS],
        "payment.currency": "USD",
        "user.id": "frl_1",
        "payment.transaction_id": "cs_1",
      },
    });
    expect(mocks.completeFreelancer.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.info.mock.invocationCallOrder[0]!,
    );
  });

  it("credits an agency purchase, then logs the payment with the team id", async () => {
    const response = await deliver(
      completed({
        payment_status: "paid",
        metadata: { purchasedConnects: String(PLAN), agencyId: "agc_1" },
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.completeAgency).toHaveBeenCalledWith("agc_1", PLAN, "cs_1");
    expect(mocks.completeFreelancer).not.toHaveBeenCalled();
    expect(mocks.info).toHaveBeenCalledWith({
      message: "Payment succeeded",
      eventName: "payment.charge.succeeded",
      attributes: {
        "payment.provider": "stripe",
        "payment.amount_cents":
          CONNECTS_PLANS[PLAN as keyof typeof CONNECTS_PLANS],
        "payment.currency": "USD",
        "team.id": "agc_1",
        "payment.transaction_id": "cs_1",
      },
    });
  });

  it("prefers the freelancer when both ids are present", async () => {
    await deliver(
      completed({
        payment_status: "paid",
        metadata: {
          purchasedConnects: String(PLAN),
          freelancerId: "frl_1",
          agencyId: "agc_1",
        },
      }),
    );

    expect(mocks.completeFreelancer).toHaveBeenCalledTimes(1);
    expect(mocks.completeAgency).not.toHaveBeenCalled();
  });

  it.each([
    ["an unpaid session", { payment_status: "unpaid" }, String(PLAN)],
    ["an unknown plan", { payment_status: "paid" }, "12345"],
    ["a missing plan", { payment_status: "paid" }, undefined],
  ])("acknowledges %s without crediting", async (_name, session, plan) => {
    const response = await deliver(
      completed({
        ...session,
        metadata: { purchasedConnects: plan, freelancerId: "frl_1" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true });
    expect(mocks.completeFreelancer).not.toHaveBeenCalled();
    expect(mocks.completeAgency).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("acknowledges a paid plan session without any buyer id", async () => {
    const response = await deliver(
      completed({
        payment_status: "paid",
        metadata: { purchasedConnects: String(PLAN) },
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.completeFreelancer).not.toHaveBeenCalled();
    expect(mocks.completeAgency).not.toHaveBeenCalled();
  });

  it("acknowledges other event types, including async payment success", async () => {
    const response = await deliver(
      completed(
        {
          payment_status: "paid",
          metadata: { purchasedConnects: String(PLAN), freelancerId: "frl_1" },
        },
        "checkout.session.async_payment_succeeded",
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.completeFreelancer).not.toHaveBeenCalled();
  });

  it("answers 500 without logging when crediting fails", async () => {
    mocks.completeFreelancer.mockRejectedValueOnce(new Error("db down"));

    const response = await deliver(
      completed({
        payment_status: "paid",
        metadata: { purchasedConnects: String(PLAN), freelancerId: "frl_1" },
      }),
    );

    expect(response.status).toBe(500);
    expect(mocks.info).not.toHaveBeenCalled();
  });
});
