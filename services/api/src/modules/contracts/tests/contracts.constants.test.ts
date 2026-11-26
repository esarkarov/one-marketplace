import { describe, expect, it } from "vitest";
import { STRIPE_PERMANENT_REFUND_ERROR_CODES } from "@/infrastructure/constants/payments.constants.js";
import { REFUND_RECONCILIATION } from "@/modules/contracts/constants/contracts.constants.js";

describe("REFUND_RECONCILIATION", () => {
  it("parks on exactly the shared permanent Stripe refund codes", () => {
    expect(REFUND_RECONCILIATION.permanentErrorCodes).toBe(
      STRIPE_PERMANENT_REFUND_ERROR_CODES,
    );
    expect([...REFUND_RECONCILIATION.permanentErrorCodes]).toEqual([
      "charge_not_refundable",
      "refund_disputed_payment",
      "resource_missing",
    ]);
  });
});
