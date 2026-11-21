import { describe, expect, it } from "vitest";
import type { AgencyMember } from "@onemarketplace/web-core";
import {
  accountTypeLabel,
  marketplaceProfileHref,
  memberProfileHref,
  MARKETPLACE_PAGE_SIZE,
  nextMarketplaceOffset,
  type MarketplaceResult,
} from "./profiles";

const result = (
  accountType: MarketplaceResult["accountType"],
): MarketplaceResult => ({
  accountType,
  avatarUrl: null,
  id: "11111111-1111-4111-8111-111111111111",
  jobSuccess: 90,
  location: "US",
  name: "Ada Lovelace",
  rating: 4.8,
  skills: [],
  title: "Engineer",
  verified: true,
});

describe("marketplace results", () => {
  it("labels and links by the spec enum", () => {
    expect(accountTypeLabel("FREELANCER")).toBe("Talent");
    expect(accountTypeLabel("AGENCY")).toBe("Agency");
    expect(marketplaceProfileHref(result("FREELANCER"))).toBe(
      "/talent/11111111-1111-4111-8111-111111111111",
    );
    expect(marketplaceProfileHref(result("AGENCY"))).toBe(
      "/agency/11111111-1111-4111-8111-111111111111",
    );
  });

  it("pages by offset until hasMore is false", () => {
    expect(nextMarketplaceOffset({ hasMore: true }, [{}, {}])).toBe(
      2 * MARKETPLACE_PAGE_SIZE,
    );
    expect(nextMarketplaceOffset({ hasMore: false }, [{}])).toBeUndefined();
  });

  it("links a member to its profile id only", () => {
    const member = { profileId: "p-1" } as AgencyMember;
    expect(memberProfileHref(member)).toBe("/talent/p-1");
    expect(memberProfileHref({ profileId: null } as AgencyMember)).toBeNull();
  });
});
