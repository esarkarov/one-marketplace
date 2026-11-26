import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("./stripe.client.js", () => ({
  stripe: { refunds: { create: mocks.create } },
}));

vi.mock("@/config/logger.js", () => ({
  logger: { warn: mocks.warn, error: mocks.error },
}));

const { paymentIntentIdOf, refundTarget } = await import("./stripe.refunds.js");

const target = {
  checkoutSessionId: "cs_1",
  paymentIntentId: "pi_1",
  amountCents: 1200,
};

const attributes = {
  "stripe.checkout_session_id": "cs_1",
  "stripe.payment_intent_id": "pi_1",
  "payment.refund_cause": "duplicate_session",
  "payment.amount_cents": 1200,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("refundTarget", () => {
  it.each([
    ["duplicate", undefined, "refund:pi_1:duplicate"],
    ["requested_by_customer", undefined, "refund:pi_1:requested_by_customer"],
    [
      "requested_by_customer",
      ":recon:3",
      "refund:pi_1:requested_by_customer:recon:3",
    ],
    ["duplicate", ":connects", "refund:pi_1:duplicate:connects"],
  ] as const)(
    "refunds %s with suffix %s under key %s",
    async (reason, keySuffix, key) => {
      const refund = { id: "re_1", status: "succeeded" };
      mocks.create.mockResolvedValue(refund);

      const result = await refundTarget(target, reason, "duplicate_session", {
        keySuffix,
      });

      expect(result).toBe(refund);
      expect(mocks.create).toHaveBeenCalledExactlyOnceWith(
        { payment_intent: "pi_1", reason },
        { idempotencyKey: key },
      );
    },
  );

  it("logs payment.refunded with the exact attributes", async () => {
    mocks.create.mockResolvedValue({ id: "re_1", status: "succeeded" });

    await refundTarget(target, "duplicate", "duplicate_session");

    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith({
      message: "Payment refunded.",
      eventName: "payment.refunded",
      attributes,
    });
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("logs payment.refund.failed and rethrows a Stripe error", async () => {
    const failure = Object.assign(new Error("down"), {
      name: "StripeConnectionError",
    });
    mocks.create.mockRejectedValue(failure);

    await expect(
      refundTarget(target, "duplicate", "duplicate_session"),
    ).rejects.toBe(failure);

    expect(mocks.error).toHaveBeenCalledExactlyOnceWith({
      message: "Payment refund failed.",
      eventName: "payment.refund.failed",
      attributes: { ...attributes, "error.name": "StripeConnectionError" },
    });
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it("logs UnknownError for a non-Error rejection", async () => {
    mocks.create.mockRejectedValue({ code: "api_error" });

    await expect(
      refundTarget(target, "duplicate", "duplicate_session"),
    ).rejects.toEqual({ code: "api_error" });

    expect(mocks.error).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: expect.objectContaining({ "error.name": "UnknownError" }),
      }),
    );
  });

  it("answers null without logging when the charge is already refunded", async () => {
    mocks.create.mockRejectedValue({ code: "charge_already_refunded" });

    await expect(
      refundTarget(target, "duplicate", "duplicate_session"),
    ).resolves.toBeNull();

    expect(mocks.warn).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it.each(["failed", "canceled"])(
    "rejects an unsettled %s refund only when asked",
    async (status) => {
      mocks.create.mockResolvedValue({ id: "re_1", status });

      await expect(
        refundTarget(target, "requested_by_customer", "contract_declined", {
          rejectUnsettled: true,
        }),
      ).rejects.toMatchObject({
        name: "RefundNotCompletedError",
        message: `Refund ${status}.`,
      });
      await expect(
        refundTarget(target, "requested_by_customer", "contract_declined"),
      ).resolves.toEqual({ id: "re_1", status });
    },
  );
});

describe("paymentIntentIdOf", () => {
  it("reads a string or an expanded payment intent", () => {
    expect(
      paymentIntentIdOf({
        payment_intent: "pi_s",
      } as Stripe.Checkout.Session),
    ).toBe("pi_s");
    expect(
      paymentIntentIdOf({
        payment_intent: { id: "pi_e" },
      } as Stripe.Checkout.Session),
    ).toBe("pi_e");
    expect(
      paymentIntentIdOf({ payment_intent: null } as Stripe.Checkout.Session),
    ).toBeUndefined();
  });
});
