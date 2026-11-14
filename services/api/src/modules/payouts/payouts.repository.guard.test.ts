import { describe, expect, it } from "vitest";
import { buildTransitionGuard } from "./payouts.repository.js";
import { PayoutTransitionError } from "./payouts.state.js";

describe("buildTransitionGuard preconditions", () => {
  it("throws a plain Error when no transition leads to the target status", () => {
    const attempt = () => buildTransitionGuard("payout-1", "PENDING");
    expect(attempt).toThrow(Error);
    expect(attempt).toThrow("No payout transition leads to PENDING");
    expect(attempt).not.toThrow(PayoutTransitionError);
  });

  it("throws PayoutTransitionError for a disallowed explicit source status", () => {
    expect(() =>
      buildTransitionGuard("payout-1", "PROCESSING", { from: "PAID" }),
    ).toThrow(PayoutTransitionError);
  });

  it("builds a guard for an allowed transition", () => {
    expect(() =>
      buildTransitionGuard("payout-1", "PAID", { from: "PROCESSING" }),
    ).not.toThrow();
    expect(() => buildTransitionGuard("payout-1", "FAILED")).not.toThrow();
  });
});
