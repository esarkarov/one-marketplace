import { describe, expect, it } from "vitest";
import { REFUND_RECONCILIATION } from "@/modules/contracts/constants/contracts.constants.js";
import {
  isPermanentRefundCode,
  isStripeUnavailable,
  stripeErrorFields,
} from "@/modules/contracts/utils/contracts.stripe-errors.js";

describe("isPermanentRefundCode", () => {
  it.each(REFUND_RECONCILIATION.permanentErrorCodes)(
    "treats %s as permanent",
    (code) => {
      expect(isPermanentRefundCode(code)).toBe(true);
    },
  );

  it("lists exactly the three reconciliation codes", () => {
    expect([...REFUND_RECONCILIATION.permanentErrorCodes]).toEqual([
      "charge_not_refundable",
      "refund_disputed_payment",
      "resource_missing",
    ]);
  });

  it.each([
    "charge_already_refunded",
    "rate_limit",
    "api_error",
    "",
    undefined,
  ])("does not treat %s as permanent", (code) => {
    expect(isPermanentRefundCode(code)).toBe(false);
  });
});

describe("stripeErrorFields", () => {
  it("reads string and number fields and ignores other shapes", () => {
    expect(
      stripeErrorFields({ code: "c", type: "t", name: "n", statusCode: 503 }),
    ).toEqual({ code: "c", type: "t", name: "n", statusCode: 503 });
    expect(stripeErrorFields({ code: 1, statusCode: "503" })).toEqual({
      code: undefined,
      type: undefined,
      name: undefined,
      statusCode: undefined,
    });
    expect(stripeErrorFields("boom")).toEqual({});
    expect(stripeErrorFields(null)).toEqual({});
  });
});

describe("isStripeUnavailable", () => {
  it.each([
    [{ type: "StripeConnectionError" }, true],
    [{ type: "StripeRateLimitError" }, true],
    [{ statusCode: 429 }, true],
    [{ statusCode: 500 }, true],
    [{ statusCode: 503 }, true],
    [{ statusCode: 400 }, false],
    [{ code: "charge_not_refundable", statusCode: 400 }, false],
    [new Error("boom"), false],
  ])("classifies %j as %s", (error, expected) => {
    expect(isStripeUnavailable(error)).toBe(expected);
  });
});
