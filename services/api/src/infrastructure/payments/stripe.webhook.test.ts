import type { Request } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("./stripe.client.js", () => ({
  stripe: { webhooks: { constructEvent: mocks.constructEvent } },
}));

const { verifyStripeWebhook } = await import("./stripe.webhook.js");
const { ApiError } = await import("@/shared/errors/api-error.js");

const buildRequest = (signature?: unknown, body: unknown = Buffer.from("{}")) =>
  ({
    headers: signature === undefined ? {} : { "stripe-signature": signature },
    body,
    logger: { warn: mocks.warn },
  }) as unknown as Request;

const options = {
  secret: "whsec_x",
  source: "stripe_test",
  missingMessage: "Invalid test webhook.",
};

const rejection = (reason: string) => ({
  message: "Webhook signature rejected",
  eventName: "webhook.inbound.rejected",
  attributes: {
    "webhook.source": "stripe_test",
    "webhook.reject_reason": reason,
  },
});

describe("verifyStripeWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.warn.mockResolvedValue(undefined);
  });

  it("returns the event constructed from the raw body, header and secret", async () => {
    const event = { id: "evt_1", type: "checkout.session.completed" };
    mocks.constructEvent.mockReturnValue(event);
    const body = Buffer.from('{"a":1}');

    const result = await verifyStripeWebhook(
      buildRequest("sig", body),
      options,
    );

    expect(result).toBe(event);
    expect(mocks.constructEvent).toHaveBeenCalledWith(body, "sig", "whsec_x");
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it("throws the missing message and logs when the header is absent", async () => {
    const error = await verifyStripeWebhook(buildRequest(), options).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      statusCode: 400,
      message: "Invalid test webhook.",
    });
    expect(mocks.warn).toHaveBeenCalledWith(
      rejection("missing_signature_or_secret"),
    );
    expect(mocks.constructEvent).not.toHaveBeenCalled();
  });

  it("treats a non-string header as missing", async () => {
    await expect(
      verifyStripeWebhook(buildRequest(["a", "b"]), options),
    ).rejects.toMatchObject({ message: "Invalid test webhook." });
    expect(mocks.constructEvent).not.toHaveBeenCalled();
  });

  it("throws the missing message and logs when the secret is unset or empty", async () => {
    for (const secret of [undefined, ""]) {
      mocks.warn.mockClear();

      await expect(
        verifyStripeWebhook(buildRequest("sig"), { ...options, secret }),
      ).rejects.toMatchObject({
        statusCode: 400,
        message: "Invalid test webhook.",
      });
      expect(mocks.warn).toHaveBeenCalledWith(
        rejection("missing_signature_or_secret"),
      );
    }
    expect(mocks.constructEvent).not.toHaveBeenCalled();
  });

  it("throws the signature message and logs when verification fails, without leaking the cause", async () => {
    mocks.constructEvent.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature");
    });

    const error = await verifyStripeWebhook(buildRequest("bad"), options).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      statusCode: 400,
      message: "Invalid Stripe webhook signature.",
    });
    expect(mocks.warn).toHaveBeenCalledOnce();
    expect(mocks.warn).toHaveBeenCalledWith(rejection("invalid_signature"));
  });

  it("waits for the rejection log before throwing", async () => {
    let logged = false;
    mocks.warn.mockImplementation(async () => {
      await Promise.resolve();
      logged = true;
    });

    await verifyStripeWebhook(buildRequest(), options).catch(() => undefined);

    expect(logged).toBe(true);
  });
});
