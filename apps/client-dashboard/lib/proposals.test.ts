import { ApiError, formatCents } from "@onemarketplace/api-client";
import { describe, expect, it } from "vitest";
import {
  canSendOffer,
  canStartInterview,
  countByFilter,
  formatLocation,
  hasInterview,
  initialsOf,
  isCheckoutUrl,
  isClientProposalItem,
  matchesFilter,
  messagesHref,
  proposalErrorMessage,
  proposalStatusLabel,
  PROPOSAL_FILTERS,
  profileHref,
  toProposalView,
  toProposalViews,
  type ClientProposalItem,
  type ProposalListItem,
} from "./proposals";

const freelancerItem: ClientProposalItem = {
  id: "11111111-1111-4111-8111-111111111111",
  senderId: "22222222-2222-4222-8222-222222222222",
  senderType: "FREELANCER",
  senderName: "Ada Lovelace",
  avatar: null,
  conversationId: null,
  contractId: null,
  contractStatus: null,
  profileId: "33333333-3333-4333-8333-333333333333",
  verified: true,
  professionalTitle: "Engineer",
  country: "US",
  city: "Austin",
  skills: ["React"],
  coverLetter: "Hello",
  bidAmountCents: 1999,
  duration: "2 weeks",
  screeningAnswers: [{ question: "Why?", answer: "Because" }],
  status: "SUBMITTED",
  isShortlisted: false,
  submittedAt: "2026-11-20T10:00:00.000Z",
  jobSuccessScore: 95,
  rating: 4.5,
  completedJobs: 7,
};

const agencyItem: ClientProposalItem = {
  ...freelancerItem,
  id: "44444444-4444-4444-8444-444444444444",
  senderType: "AGENCY",
  senderName: "Studio",
  memberCount: 1,
  agencyTags: ["design"],
  profileId: null,
  professionalTitle: null,
};

const names = (code: string) => (code === "US" ? "United States" : undefined);

describe("proposalStatusLabel", () => {
  it("labels every status of the spec enum explicitly", () => {
    expect(proposalStatusLabel("SUBMITTED")).toBe("New");
    expect(proposalStatusLabel("VIEWED")).toBe("Viewed");
    expect(proposalStatusLabel("INTERVIEWED")).toBe("Interview");
    expect(proposalStatusLabel("HIRED")).toBe("Hired");
  });

  it("shows an unknown status as received", () => {
    expect(proposalStatusLabel("WITHDRAWN")).toBe("WITHDRAWN");
    expect(proposalStatusLabel("toString")).toBe("toString");
  });
});

describe("toProposalView", () => {
  it("keeps cents and maps a freelancer", () => {
    const view = toProposalView(freelancerItem, names);
    expect(view.bidCents).toBe(1999);
    expect(formatCents(view.bidCents)).toBe("$19.99");
    expect(view.accountType).toBe("Freelancer");
    expect(view.title).toBe("Engineer");
    expect(view.location).toBe("Austin, United States");
    expect(view.statusLabel).toBe("New");
    expect(view.initials).toBe("AL");
    expect(view.id).toBe(freelancerItem.id);
  });

  it("maps an agency with a singular member count", () => {
    const view = toProposalView(agencyItem);
    expect(view.accountType).toBe("Agency");
    expect(view.title).toBe("Agency · 1 member");
    expect(toProposalView({ ...agencyItem, memberCount: 3 }).title).toBe(
      "Agency · 3 members",
    );
  });

  it("falls back for a missing name, avatar and location", () => {
    const view = toProposalView({
      ...freelancerItem,
      senderName: null,
      avatarUrl: null,
      city: null,
      country: null,
      professionalTitle: null,
      verified: null,
      skills: null,
    } as never);
    expect(view.bidder).toBe("Freelancer");
    expect(view.avatarUrl).toBeNull();
    expect(view.location).toBe("Location unavailable");
    expect(view.title).toBe("Freelancer");
    expect(view.verified).toBe(false);
    expect(view.skills).toEqual([]);
  });

  it("labels HIRED instead of treating it as new", () => {
    expect(
      toProposalView({ ...freelancerItem, status: "HIRED" }).statusLabel,
    ).toBe("Hired");
  });
});

describe("toProposalViews", () => {
  it("drops items that are not client items", () => {
    const freelancerSide = {
      id: "x",
      jobId: "y",
      title: "t",
      company: null,
      status: "SUBMITTED",
      submittedAt: null,
      budgetCents: 1,
      bidAmountCents: 1,
      duration: "d",
      coverLetter: "c",
      skills: [],
    } as ProposalListItem;
    expect(isClientProposalItem(freelancerSide)).toBe(false);
    expect(
      toProposalViews([freelancerItem, freelancerSide, agencyItem]),
    ).toHaveLength(2);
  });
});

describe("filters", () => {
  const rows = [
    { statusLabel: "New", isShortlisted: false },
    { statusLabel: "Interview", isShortlisted: true },
    { statusLabel: "Hired", isShortlisted: false },
  ];

  it("offers a tab for every status label and no tab without an API status", () => {
    expect(PROPOSAL_FILTERS).toEqual([
      "All",
      "New",
      "Viewed",
      "Shortlisted",
      "Interview",
      "Hired",
    ]);
  });

  it("matches by status or by the shortlist flag", () => {
    expect(matchesFilter(rows[1]!, "Interview")).toBe(true);
    expect(matchesFilter(rows[1]!, "Shortlisted")).toBe(true);
    expect(matchesFilter(rows[0]!, "Shortlisted")).toBe(false);
    expect(countByFilter(rows, "All")).toBe(3);
    expect(countByFilter(rows, "Hired")).toBe(1);
  });
});

describe("helpers", () => {
  it("builds initials from at most two words", () => {
    expect(initialsOf("ada lovelace byron")).toBe("AL");
    expect(initialsOf("  ")).toBe("");
  });

  it("formats a location", () => {
    expect(formatLocation("Paris", "FR", names)).toBe("Paris, FR");
    expect(formatLocation(null, "US", names)).toBe("United States");
  });

  it("links profiles by profile id for talent and sender id for agencies", () => {
    expect(profileHref(toProposalView(freelancerItem))).toBe(
      "/talent/33333333-3333-4333-8333-333333333333",
    );
    expect(profileHref(toProposalView(agencyItem))).toBe(
      `/agency/${agencyItem.senderId}`,
    );
    expect(
      profileHref(toProposalView({ ...freelancerItem, profileId: null })),
    ).toBeNull();
  });

  it("decides which actions are offered", () => {
    expect(canSendOffer({ status: "VIEWED", contractId: null })).toBe(true);
    expect(canSendOffer({ status: "HIRED", contractId: null })).toBe(false);
    expect(canSendOffer({ status: "VIEWED", contractId: "c" })).toBe(false);
    expect(canStartInterview({ status: "HIRED", conversationId: null })).toBe(
      false,
    );
    expect(canStartInterview({ status: "VIEWED", conversationId: null })).toBe(
      true,
    );
    expect(hasInterview({ status: "INTERVIEWED", conversationId: "c" })).toBe(
      true,
    );
    expect(hasInterview({ status: "INTERVIEWED", conversationId: null })).toBe(
      false,
    );
    expect(hasInterview({ status: "VIEWED", conversationId: "c" })).toBe(false);
  });

  it("builds the messages link", () => {
    expect(messagesHref("abc")).toBe("/messages?conversationId=abc");
  });

  it("accepts only https checkout urls", () => {
    expect(isCheckoutUrl("https://checkout.stripe.com/c/pay/x")).toBe(true);
    expect(isCheckoutUrl("http://checkout.stripe.com/x")).toBe(false);
    expect(isCheckoutUrl("javascript:alert(1)")).toBe(false);
    expect(isCheckoutUrl("not a url")).toBe(false);
  });
});

describe("proposalErrorMessage", () => {
  it("shows a 4xx message with the request id", () => {
    const error = new ApiError({
      message: "Interview has already been started.",
      status: 409,
      code: "CONFLICT",
      requestId: "req-1",
    });
    expect(proposalErrorMessage(error)).toBe(
      "Interview has already been started. (reference req-1)",
    );
  });

  it("hides 5xx details and unknown errors", () => {
    const server = new ApiError({
      message: "db exploded",
      status: 500,
      code: "INTERNAL",
    });
    expect(proposalErrorMessage(server)).toBe(
      "Something went wrong. Please try again.",
    );
    expect(proposalErrorMessage(new Error("boom"))).toBe(
      "Something went wrong. Please try again.",
    );
  });
});
