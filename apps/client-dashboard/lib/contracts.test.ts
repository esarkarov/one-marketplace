import { ApiError } from "@onemarketplace/api-client";
import { describe, expect, it } from "vitest";
import {
  ADD_MILESTONE_MAX_CENTS,
  ADD_MILESTONE_MIN_CENTS,
  canAddMilestone,
  canFinishContract,
  canFundMilestone,
  canGiveReview,
  canReviewMilestone,
  canWithdrawContract,
  contractErrorMessage,
  contractErrorMessageOf,
  contractHref,
  contractStatusLabel,
  contractStatusTone,
  contractTotals,
  counterpartyLabel,
  findContract,
  hasActiveContract,
  InvalidCheckoutUrlError,
  messagesLink,
  milestoneLabel,
  milestoneState,
  nextDeadline,
  safeCheckoutUrl,
  sumContractTotals,
  todayLocalDate,
  validateAddMilestone,
  validateContractReview,
  validateFeedback,
  validateRequirements,
  type ContractItem,
  type MilestoneItem,
  MILESTONE_AMOUNT_HINT,
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

describe("status labels", () => {
  it("labels every contract status explicitly, CANCELLED included", () => {
    expect(contractStatusLabel("PENDING")).toBe("Awaiting approval");
    expect(contractStatusLabel("ACTIVE")).toBe("Active");
    expect(contractStatusLabel("COMPLETED")).toBe("Completed");
    expect(contractStatusLabel("CANCELLED")).toBe("Cancelled");
  });

  it("shows an unknown status as received", () => {
    expect(contractStatusLabel("PAUSED")).toBe("PAUSED");
    expect(contractStatusLabel("toString")).toBe("toString");
    expect(contractStatusTone("PAUSED")).toBe("unknown");
    expect(contractStatusTone("CANCELLED")).toBe("cancelled");
  });

  it("derives the milestone state from status and paymentRequestedAt", () => {
    expect(milestoneState(paid)).toBe("PAID");
    expect(milestoneState(inProgress)).toBe("IN_PROGRESS");
    expect(milestoneState(submitted)).toBe("SUBMITTED");
    expect(milestoneState(upcoming)).toBe("UPCOMING");
    expect(milestoneLabel(submitted)).toBe("Submitted");
    expect(milestoneLabel(upcoming)).toBe("Upcoming");
    expect(milestoneLabel(paid)).toBe("Paid");
  });

  it("shows an unknown milestone status as received", () => {
    const odd = { ...upcoming, status: "DISPUTED" } as unknown as MilestoneItem;
    expect(milestoneState(odd)).toBe("UNKNOWN");
    expect(milestoneLabel(odd)).toBe("DISPUTED");
  });

  it("labels counterparties", () => {
    expect(counterpartyLabel("FREELANCER")).toBe("Freelancer");
    expect(counterpartyLabel("AGENCY")).toBe("Agency");
    expect(counterpartyLabel("OTHER")).toBe("OTHER");
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

describe("action rules", () => {
  it("funds only the next upcoming milestone of an active contract", () => {
    const milestones = [paid, upcoming];
    expect(canFundMilestone(contract({ milestones }), 1)).toBe(true);
    expect(canFundMilestone(contract({ milestones }), 0)).toBe(false);
    expect(
      canFundMilestone(contract({ status: "PENDING", milestones }), 1),
    ).toBe(false);
    expect(
      canFundMilestone(contract({ status: "CANCELLED", milestones }), 1),
    ).toBe(false);
    expect(
      canFundMilestone(contract({ milestones: [inProgress, upcoming] }), 1),
    ).toBe(false);
    expect(
      canFundMilestone(contract({ milestones: [upcoming, upcoming] }), 1),
    ).toBe(false);
  });

  it("reviews only a submitted milestone", () => {
    const active = contract({ milestones: [submitted] });
    expect(canReviewMilestone(active, submitted)).toBe(true);
    expect(canReviewMilestone(active, inProgress)).toBe(false);
    expect(
      canReviewMilestone(contract({ status: "CANCELLED" }), submitted),
    ).toBe(false);
  });

  it("finishes or extends only when every milestone is paid", () => {
    expect(canFinishContract(contract({ milestones: [paid] }))).toBe(true);
    expect(canAddMilestone(contract({ milestones: [paid] }))).toBe(true);
    expect(canFinishContract(contract({ milestones: [paid, upcoming] }))).toBe(
      false,
    );
    expect(canFinishContract(contract({ milestones: [] }))).toBe(true);
    expect(canAddMilestone(contract({ milestones: [] }))).toBe(true);
    expect(canAddMilestone(contract({ milestones: [paid, upcoming] }))).toBe(
      false,
    );
    expect(
      canAddMilestone(contract({ status: "PENDING", milestones: [] })),
    ).toBe(false);
    expect(
      canFinishContract(contract({ status: "COMPLETED", milestones: [paid] })),
    ).toBe(false);
  });

  it("withdraws only a pending offer", () => {
    expect(canWithdrawContract({ status: "PENDING" })).toBe(true);
    expect(canWithdrawContract({ status: "ACTIVE" })).toBe(false);
    expect(canWithdrawContract({ status: "CANCELLED" })).toBe(false);
  });

  it("offers a review once for a completed contract", () => {
    expect(
      canGiveReview({ status: "COMPLETED", reviewedByCurrentUser: false }),
    ).toBe(true);
    expect(
      canGiveReview({ status: "COMPLETED", reviewedByCurrentUser: true }),
    ).toBe(false);
    expect(
      canGiveReview({ status: "CANCELLED", reviewedByCurrentUser: false }),
    ).toBe(false);
  });

  it("detects an active contract", () => {
    expect(hasActiveContract([{ status: "PENDING" }])).toBe(false);
    expect(
      hasActiveContract([{ status: "CANCELLED" }, { status: "ACTIVE" }]),
    ).toBe(true);
  });
});

describe("links and ids", () => {
  it("finds a contract by the contractId parameter", () => {
    const items = [contract()];
    expect(findContract(items, items[0]!.id)).toBe(items[0]);
    expect(findContract(items, "nope")).toBe(null);
    expect(findContract(items, null)).toBe(null);
  });

  it("builds encoded links", () => {
    expect(contractHref("abc")).toBe("/contracts?contractId=abc");
    expect(messagesLink("a b")).toBe("/messages?conversationId=a%20b");
    expect(messagesLink(null)).toBe(null);
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

describe("add milestone validation", () => {
  const today = "2026-11-21";

  it("converts dollars to cents without float math", () => {
    const result = validateAddMilestone(
      { title: " Phase two ", amount: "19.99", dueDate: "2026-12-01" },
      today,
    );
    expect(result).toEqual({
      ok: true,
      value: { title: "Phase two", amountCents: 1999, dueDate: "2026-12-01" },
    });
  });

  it("rejects bad titles, amounts and dates", () => {
    expect(
      validateAddMilestone({ title: "ab", amount: "20", dueDate: today }, today)
        .ok,
    ).toBe(false);
    expect(
      validateAddMilestone(
        { title: "Phase", amount: "9.99", dueDate: today },
        today,
      ).ok,
    ).toBe(false);
    expect(
      validateAddMilestone(
        { title: "Phase", amount: "10.001", dueDate: today },
        today,
      ).ok,
    ).toBe(false);
    expect(
      validateAddMilestone(
        { title: "Phase", amount: "1e3", dueDate: today },
        today,
      ).ok,
    ).toBe(false);
    expect(
      validateAddMilestone(
        { title: "Phase", amount: "20", dueDate: "2026-11-20" },
        today,
      ),
    ).toEqual({ ok: false, message: "The due date cannot be in the past." });
    expect(
      validateAddMilestone({ title: "Phase", amount: "20", dueDate: "" }, today)
        .ok,
    ).toBe(false);
  });

  it("matches the backend add-milestone amount bounds", () => {
    expect(ADD_MILESTONE_MIN_CENTS).toBe(1000);
    expect(ADD_MILESTONE_MAX_CENTS).toBe(100_000_000);
    expect(
      validateAddMilestone(
        { title: "Phase", amount: "10", dueDate: today },
        today,
      ),
    ).toEqual({
      ok: true,
      value: { title: "Phase", amountCents: 1000, dueDate: today },
    });
    expect(
      validateAddMilestone(
        { title: "Phase", amount: "5.01", dueDate: today },
        today,
      ),
    ).toEqual({ ok: false, message: "Budget must be at least $10.00." });
    expect(
      validateAddMilestone(
        { title: "Phase", amount: "1000000", dueDate: today },
        today,
      ).ok,
    ).toBe(true);
    expect(
      validateAddMilestone(
        { title: "Phase", amount: "1000000.01", dueDate: today },
        today,
      ),
    ).toEqual({ ok: false, message: "Budget cannot exceed $1,000,000.00." });
  });

  it("formats the local date", () => {
    expect(todayLocalDate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("text validation", () => {
  it("requires feedback of 10 to 5000 characters", () => {
    expect(validateFeedback("short").ok).toBe(false);
    expect(validateFeedback("  please fix the logo  ")).toEqual({
      ok: true,
      value: "please fix the logo",
    });
    expect(validateFeedback("x".repeat(5001)).ok).toBe(false);
  });

  it("limits requirements and drops empty ones", () => {
    expect(validateRequirements("   ")).toEqual({ ok: true, value: undefined });
    expect(validateRequirements("x".repeat(501)).ok).toBe(false);
  });

  it("requires a rating and a review of 10 to 1000 characters", () => {
    expect(
      validateContractReview({ rating: 0, comment: "great work!!" }).ok,
    ).toBe(false);
    expect(
      validateContractReview({ rating: 6, comment: "great work!!" }).ok,
    ).toBe(false);
    expect(validateContractReview({ rating: 5, comment: "short" }).ok).toBe(
      false,
    );
    expect(
      validateContractReview({ rating: 5, comment: " great work!! " }),
    ).toEqual({ ok: true, value: { rating: 5, comment: "great work!!" } });
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

describe("add milestone copy", () => {
  it("derives the hint and both bound messages from the constants", () => {
    expect(MILESTONE_AMOUNT_HINT).toBe("At least $10.00");
    const run = (amount: string) =>
      validateAddMilestone(
        { title: "Phase two", amount, dueDate: "2030-01-01" },
        "2029-01-01",
      );
    expect(run("9.99")).toEqual({
      ok: false,
      message: "Budget must be at least $10.00.",
    });
    expect(run("1000000.01")).toEqual({
      ok: false,
      message: "Budget cannot exceed $1,000,000.00.",
    });
    expect(run("1000000").ok).toBe(true);
  });
});
