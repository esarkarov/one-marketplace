import type { Components } from "@onemarketplace/api-client";
import { describe, expect, it } from "vitest";
import {
  contractMoneyView,
  jobPostMoneyView,
  overviewVolumeView,
  proposalMoneyView,
  transactionAmountView,
} from "./money-views";

type Schemas = Components["schemas"];

describe("money views", () => {
  it("formats the overview volume from cents", () => {
    expect(
      overviewVolumeView({
        totalContractValueCents: 1_234_567,
        totalPaidOutCents: 100,
        totalConnectsRevenueCents: 5,
      }),
    ).toEqual({
      totalContractValue: "$12,345.67",
      totalPaidOut: "$1.00",
      connectsRevenue: "$0.05",
    });
  });

  it("formats job post budgets from cents", () => {
    const job = {
      totalBudgetCents: 250_000,
      milestones: [
        { id: "m1", title: "a", budgetCents: 99_950, dueDate: "2026-12-01" },
      ],
    } as Schemas["AdminJobPostItem"];
    expect(jobPostMoneyView(job)).toEqual({
      totalBudget: "$2,500.00",
      milestones: [{ id: "m1", budget: "$999.50" }],
    });
  });

  it("formats proposal amounts from cents", () => {
    expect(
      proposalMoneyView({
        bidAmountCents: 4_200,
        jobBudgetCents: 10_000,
      } as Schemas["AdminProposalItem"]),
    ).toEqual({ bid: "$42.00", jobBudget: "$100.00" });
  });

  it("formats contract amounts from cents", () => {
    const contract = {
      totalAmountCents: 75_025,
      milestones: [{ id: "m1", amountCents: 25_000 }],
    } as Schemas["AdminContractItem"];
    expect(contractMoneyView(contract)).toEqual({
      total: "$750.25",
      milestones: [{ id: "m1", amount: "$250.00" }],
    });
  });

  it("formats a transaction amount from cents", () => {
    expect(
      transactionAmountView({
        amountCents: 1,
      } as Schemas["AdminTransactionItem"]),
    ).toBe("$0.01");
    expect(
      transactionAmountView({
        amountCents: 0,
      } as Schemas["AdminTransactionItem"]),
    ).toBe("$0.00");
  });
});
