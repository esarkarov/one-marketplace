import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_ROUTES,
  notificationCategory,
  notificationHref,
} from "./notification-routes";

describe("notificationHref", () => {
  it.each([
    ["CONTRACT_OFFER", "/contracts"],
    ["CONTRACT_ACCEPTED", "/contracts"],
    ["CONTRACT_DECLINED", "/contracts"],
    ["CONTRACT_WITHDRAWN", "/contracts"],
    ["CONTRACT_COMPLETED", "/contracts"],
    ["MILESTONE_ADDED", "/contracts"],
    ["MILESTONE_FUNDED", "/contracts"],
    ["MILESTONE_SUBMITTED", "/contracts"],
    ["MILESTONE_APPROVED", "/contracts"],
    ["MILESTONE_CHANGES_REQUESTED", "/contracts"],
    ["PROPOSAL_RECEIVED", "/proposals"],
    ["PROPOSAL_VIEWED", "/proposals"],
    ["PROPOSAL_INTERVIEWED", "/messages"],
  ])("routes %s to %s", (type, route) => {
    expect(notificationHref(type)).toBe(route);
  });

  it.each([
    "PAYOUT_COMPLETED",
    "AGENCY_INVITATION",
    "AGENCY_WELCOME_BONUS",
    "REVIEW_RECEIVED",
    "SOMETHING_NEW",
    "",
  ])("does not navigate for %s", (type) => {
    expect(notificationHref(type, "/contracts?contractId=1")).toBeNull();
  });

  it("keeps the query of a link that stays inside the route", () => {
    expect(
      notificationHref("MILESTONE_SUBMITTED", "/contracts?contractId=c-1"),
    ).toBe("/contracts?contractId=c-1");
    expect(notificationHref("PROPOSAL_RECEIVED", "/proposals/job-1")).toBe(
      "/proposals/job-1",
    );
    expect(
      notificationHref("PROPOSAL_INTERVIEWED", "/messages?conversationId=c1"),
    ).toBe("/messages?conversationId=c1");
  });

  it("falls back to the base route when the link points elsewhere", () => {
    expect(
      notificationHref("CONTRACT_OFFER", "/messages?conversationId=c1"),
    ).toBe("/contracts");
    expect(notificationHref("CONTRACT_OFFER", "/contractsx")).toBe(
      "/contracts",
    );
    expect(notificationHref("CONTRACT_OFFER", null)).toBe("/contracts");
  });

  it("never follows an external or protocol-relative link", () => {
    expect(
      notificationHref("CONTRACT_OFFER", "https://evil.example/contracts"),
    ).toBe("/contracts");
    expect(notificationHref("CONTRACT_OFFER", "//evil.example/contracts")).toBe(
      "/contracts",
    );
  });
});

describe("notificationCategory", () => {
  it("maps known types and defaults to Account", () => {
    expect(notificationCategory("MILESTONE_FUNDED")).toBe("Payments");
    expect(notificationCategory("PAYOUT_COMPLETED")).toBe("Payments");
    expect(notificationCategory("CONTRACT_OFFER")).toBe("Contracts");
    expect(notificationCategory("PROPOSAL_INTERVIEWED")).toBe("Proposals");
    expect(notificationCategory("AGENCY_INVITATION")).toBe("Account");
    expect(notificationCategory("UNKNOWN")).toBe("Account");
  });

  it("only routes to paths the client app has", () => {
    const known = new Set<string | null>([
      "/contracts",
      "/proposals",
      "/messages",
      null,
    ]);
    for (const route of Object.values(NOTIFICATION_ROUTES)) {
      expect(known.has(route.base)).toBe(true);
    }
  });
});
