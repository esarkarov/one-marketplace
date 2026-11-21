import { ApiError } from "@onemarketplace/api-client";
import { describe, expect, it } from "vitest";
import {
  accountTypeLabel,
  completedWork,
  formatHourlyRate,
  formatJobSuccess,
  formatMonthYear,
  formatRating,
  initialsOf,
  isProfileNotFound,
  marketplaceProfileHref,
  memberProfileHref,
  MARKETPLACE_PAGE_SIZE,
  nextMarketplaceOffset,
  ongoingWork,
  paginate,
  profileErrorMessage,
  safeHttpsUrl,
  talentLocation,
  talentProjectCount,
  type AgencyMember,
  type MarketplaceResult,
  type TalentProfile,
  type WorkEntry,
} from "./profiles";

const entry = (overrides: Partial<WorkEntry>): WorkEntry => ({
  id: "w1",
  title: "Build",
  client: "Acme",
  status: "COMPLETED",
  completed: "2026-03-10T00:00:00.000Z",
  amountCents: 150000,
  rating: 4.5,
  review: "Great",
  clientHasReviewed: true,
  freelancerHasReviewed: true,
  ...overrides,
});

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

describe("paginate", () => {
  const items = [1, 2, 3, 4, 5];

  it("slices and reports the range", () => {
    expect(paginate(items, 2, 2)).toMatchObject({
      items: [3, 4],
      page: 2,
      totalPages: 3,
      from: 3,
      to: 4,
      total: 5,
    });
  });

  it("clamps out-of-range and non-finite pages", () => {
    expect(paginate(items, 99, 2).page).toBe(3);
    expect(paginate(items, 0, 2).page).toBe(1);
    expect(paginate(items, Number.NaN, 2).page).toBe(1);
    expect(paginate(items, 3, 2).items).toEqual([5]);
  });

  it("handles an empty list", () => {
    expect(paginate([], 1, 2)).toMatchObject({
      items: [],
      page: 1,
      totalPages: 1,
      from: 0,
      to: 0,
    });
  });
});

describe("work history", () => {
  it("keeps only completed, mutually reviewed, rated work and formats cents", () => {
    const work = completedWork([
      entry({ id: "a" }),
      entry({ id: "b", status: "ACTIVE" }),
      entry({ id: "c", clientHasReviewed: false }),
      entry({ id: "d", freelancerHasReviewed: false }),
      entry({ id: "e", rating: null }),
    ]);
    expect(work).toEqual([
      {
        id: "a",
        project: "Build",
        client: "Acme",
        completed: "March 2026",
        budget: "$1,500.00",
        rating: "4.5",
        review: "Great",
      },
    ]);
  });

  it("selects active work only", () => {
    const jobs = [entry({ id: "a" }), entry({ id: "b", status: "ACTIVE" })];
    expect(ongoingWork(jobs).map((job) => job.id)).toEqual(["b"]);
  });

  it("falls back for a missing or invalid date", () => {
    expect(formatMonthYear(null, "Recently")).toBe("Recently");
    expect(formatMonthYear("nope", "Recently")).toBe("Recently");
  });
});

describe("display helpers", () => {
  it("formats rate, rating and success", () => {
    expect(formatHourlyRate(7550)).toBe("$75.50/hr");
    expect(formatRating(null)).toBe("N/A");
    expect(formatRating(4.25)).toBe("4.3");
    expect(formatJobSuccess(0)).toBe("N/A");
    expect(formatJobSuccess(97.4)).toBe("97%");
  });

  it("builds initials", () => {
    expect(initialsOf("ada king lovelace")).toBe("AK");
    expect(initialsOf("   ")).toBe("?");
  });

  it("accepts only https urls", () => {
    expect(safeHttpsUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(safeHttpsUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpsUrl("http://example.com")).toBeNull();
    expect(safeHttpsUrl(null)).toBeNull();
  });

  it("builds the talent location and project count", () => {
    expect(
      talentLocation({ city: "Austin", country: "US" }, (code) =>
        code === "US" ? "United States" : undefined,
      ),
    ).toBe("Austin, United States");
    expect(talentLocation({ city: "", country: "ZZ" }, () => undefined)).toBe(
      "ZZ",
    );
    const base = {
      workHistory: [],
      stats: { completedJobs: 2, ongoingJobs: 1 },
    } as unknown as TalentProfile;
    expect(talentProjectCount(base)).toBe(3);
    expect(
      talentProjectCount({
        ...base,
        workHistory: [entry({})],
      } as unknown as TalentProfile),
    ).toBe(1);
  });
});

describe("errors", () => {
  const error = new ApiError({
    status: 404,
    code: "PROFILE_NOT_FOUND",
    message: "Not found.",
    requestId: "req-1",
  });

  it("adds the request id as a reference", () => {
    expect(profileErrorMessage(error)).toBe("Not found. (reference req-1)");
  });

  it("detects a 404", () => {
    expect(isProfileNotFound(error)).toBe(true);
    expect(isProfileNotFound(new Error("x"))).toBe(false);
  });
});
