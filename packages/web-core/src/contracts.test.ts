import { ApiError } from "@onemarketplace/api-client";
import { describe, expect, it } from "vitest";
import {
  InvalidCheckoutUrlError,
  contractErrorMessage,
  contractErrorMessageOf,
  contractTotals,
  milestoneState,
  nextDeadline,
  safeCheckoutUrl,
  sumContractTotals,
  type ContractItem,
  type MilestoneItem,
} from "./contracts";

const milestone = (overrides: Partial<MilestoneItem> = {}): MilestoneItem => ({
  id: "11111111-1111-4111-8111-111111111111",
  title: "Design",
  amountCents: 150000,
  dueDate: "2027-01-15",
  position: 0,
  status: "PENDING",
  fundedAt: null,
  paymentRequestedAt: null,
  submissionMessage: null,
  submissionDeliveryLink: null,
  completedAt: null,
  ...overrides,
});

const contract = (overrides: Partial<ContractItem> = {}): ContractItem => ({
  id: "22222222-2222-4222-8222-222222222222",
  proposalId: "33333333-3333-4333-8333-333333333333",
  jobId: "44444444-4444-4444-8444-444444444444",
  title: "Build site",
  description: "Details",
  totalAmountCents: 250000,
  status: "ACTIVE",
  startedAt: "2026-11-01T00:00:00.000Z",
  completedAt: null,
  createdAt: "2026-10-30T00:00:00.000Z",
  conversationId: null,
  counterpartyId: null,
  counterpartyType: "FREELANCER",
  counterpartyName: "Ada Lovelace",
  counterpartyAvatar: null,
  reviewedByCurrentUser: false,
  milestones: [],
  ...overrides,
});

const paid = milestone({
  status: "COMPLETED",
  fundedAt: "2026-11-02T00:00:00.000Z",
  amountCents: 100000,
});
const inProgress = milestone({
  id: "55555555-5555-4555-8555-555555555555",
  status: "ACTIVE",
  fundedAt: "2026-11-03T00:00:00.000Z",
  amountCents: 150000,
});
const submitted = {
  ...inProgress,
  paymentRequestedAt: "2026-11-04T00:00:00.000Z",
};
const upcoming = milestone({ id: "66666666-6666-4666-8666-666666666666" });

describe("milestone state", () => {
  it("derives the milestone state from status and paymentRequestedAt", () => {
    expect(milestoneState(paid)).toBe("PAID");
    expect(milestoneState(inProgress)).toBe("IN_PROGRESS");
    expect(milestoneState(submitted)).toBe("SUBMITTED");
    expect(milestoneState(upcoming)).toBe("UPCOMING");
  });

  it("shows an unknown milestone status as UNKNOWN", () => {
    const odd = { ...upcoming, status: "DISPUTED" } as unknown as MilestoneItem;
    expect(milestoneState(odd)).toBe("UNKNOWN");
  });
});

describe("money totals", () => {
  it("sums paid and funded cents with integers only", () => {
    const totals = contractTotals(
      contract({ milestones: [paid, inProgress, upcoming] }),
    );
    expect(totals.paidCents).toBe(100000);
    expect(totals.escrowCents).toBe(150000);
    expect(totals.totalCents).toBe(250000);
    expect(totals.progressPercent).toBe(40);
  });

  it("does not divide by zero and caps progress", () => {
    expect(
      contractTotals(contract({ totalAmountCents: 0, milestones: [paid] }))
        .progressPercent,
    ).toBe(0);
    expect(
      contractTotals(contract({ totalAmountCents: 1000, milestones: [paid] }))
        .progressPercent,
    ).toBe(100);
  });

  it("keeps cents exact for amounts that break float math", () => {
    const a = milestone({ status: "COMPLETED", amountCents: 10 });
    const b = milestone({ status: "COMPLETED", amountCents: 20 });
    expect(
      contractTotals(contract({ totalAmountCents: 30, milestones: [a, b] }))
        .paidCents,
    ).toBe(30);
  });

  it("leaves cancelled contracts out of the summary", () => {
    const summary = sumContractTotals([
      contract({ milestones: [paid, inProgress] }),
      contract({ status: "CANCELLED", milestones: [paid] }),
    ]);
    expect(summary).toEqual({
      paidCents: 100000,
      escrowCents: 150000,
      activeCount: 1,
    });
  });

  it("picks the next deadline only for live contracts", () => {
    const milestones = [paid, upcoming];
    expect(nextDeadline(contract({ milestones }))).toBe("2027-01-15");
    expect(nextDeadline(contract({ status: "CANCELLED", milestones }))).toBe(
      null,
    );
    expect(nextDeadline(contract({ milestones: [paid] }))).toBe(null);
  });
});

describe("checkout url", () => {
  it("accepts https only", () => {
    expect(safeCheckoutUrl("https://checkout.stripe.com/c/pay/x")).toBe(
      "https://checkout.stripe.com/c/pay/x",
    );
    expect(safeCheckoutUrl("http://checkout.stripe.com/x")).toBe(null);
    expect(safeCheckoutUrl("javascript:alert(1)")).toBe(null);
    expect(safeCheckoutUrl("//evil.example")).toBe(null);
    expect(safeCheckoutUrl("")).toBe(null);
    expect(safeCheckoutUrl("https://user:pw@checkout.stripe.com/x")).toBe(null);
  });
});

describe("error mapping", () => {
  it("shows the API message and the request id for a 4xx", () => {
    const error = new ApiError({
      status: 409,
      code: "MILESTONE_ADD_NOT_ALLOWED",
      message: "You cannot add a milestone yet.",
      requestId: "req-1",
    });
    expect(contractErrorMessage(error)).toBe(
      "You cannot add a milestone yet. (reference req-1)",
    );
  });

  it("hides 5xx detail and handles non API errors", () => {
    const error = new ApiError({
      status: 500,
      code: "INTERNAL_ERROR",
      message: "stack at db.ts:12",
      requestId: "req-2",
    });
    expect(contractErrorMessage(error)).not.toContain("stack");
    expect(contractErrorMessage(new Error("boom"))).not.toContain("boom");
  });

  it("returns an empty message when there is no error", () => {
    expect(contractErrorMessageOf(null)).toBe("");
    expect(contractErrorMessageOf(undefined)).toBe("");
    expect(contractErrorMessageOf(new InvalidCheckoutUrlError())).toBe(
      "Checkout returned an invalid address.",
    );
  });

  it("shows the invalid checkout address message", () => {
    expect(contractErrorMessage(new InvalidCheckoutUrlError())).toBe(
      "Checkout returned an invalid address.",
    );
  });
});
