import { describe, expect, it } from "vitest";
import {
  emptyProfileValues,
  fieldErrorsFromApi,
  formatBudgetCents,
  formatCompactCents,
  hasFieldErrors,
  isValidWebsite,
  joinedYear,
  mergeSavedProfile,
  profileToValues,
  resolveIndustry,
  splitIndustry,
  toProfileBody,
  validateProfileValues,
  type ClientProfile,
  AVATAR_MAX_BYTES,
  AVATAR_SIZE_MESSAGE,
} from "./client-profile";

const valid = {
  professionalRole: "Managing Director",
  companyName: "Acme Ltd.",
  companyWebsite: "https://acme.example",
  companySize: "2–10 employees",
  industry: "Education",
  companyDescription: "We build things.",
  country: "GB",
};

const profile: ClientProfile = {
  professionalRole: "CTO",
  companyName: "Acme",
  companyWebsite: "https://acme.example",
  companySize: "Just me",
  industry: "Real estate",
  companyDescription: "Homes",
  country: "US",
  identityVerified: true,
  paymentMethodVerified: false,
  joinedAt: "2026-03-04T10:00:00.000Z",
};

describe("validateProfileValues", () => {
  it("accepts a complete form", () => {
    expect(validateProfileValues(valid, new Set(["GB"]))).toEqual({});
  });

  it("requires every field", () => {
    const errors = validateProfileValues({
      ...emptyProfileValues(),
      companySize: "",
      industry: "",
    });
    expect(Object.keys(errors).sort()).toEqual([
      "companyDescription",
      "companyName",
      "companySize",
      "companyWebsite",
      "country",
      "industry",
      "professionalRole",
    ]);
  });

  it("treats whitespace as empty", () => {
    expect(
      validateProfileValues({ ...valid, companyName: "   " }).companyName,
    ).toBe("This field is required.");
  });

  it("enforces the API length limits", () => {
    expect(
      validateProfileValues({ ...valid, professionalRole: "a".repeat(101) })
        .professionalRole,
    ).toMatch(/at most 100/);
    expect(
      validateProfileValues({ ...valid, companyDescription: "a".repeat(5000) })
        .companyDescription,
    ).toBeUndefined();
    expect(
      validateProfileValues({ ...valid, companyDescription: "a".repeat(5001) })
        .companyDescription,
    ).toMatch(/at most 5000/);
  });

  it("rejects a website that is not http or https", () => {
    expect(isValidWebsite("https://a.example")).toBe(true);
    expect(isValidWebsite("http://a.example/x?y=1")).toBe(true);
    expect(isValidWebsite("javascript:alert(1)")).toBe(false);
    expect(isValidWebsite("acme.example")).toBe(false);
    expect(
      validateProfileValues({ ...valid, companyWebsite: "ftp://a.example" })
        .companyWebsite,
    ).toMatch(/full URL/);
  });

  it("rejects a country that is not a known ISO code", () => {
    expect(
      validateProfileValues({ ...valid, country: "gb" }, new Set(["GB"])),
    ).toEqual({});
    expect(
      validateProfileValues({ ...valid, country: "ZZZ" }).country,
    ).toBeDefined();
    expect(
      validateProfileValues({ ...valid, country: "XX" }, new Set(["GB"]))
        .country,
    ).toBeDefined();
  });
});

describe("toProfileBody", () => {
  it("trims text and uppercases the country", () => {
    expect(
      toProfileBody({
        ...valid,
        companyName: "  Acme  ",
        country: " gb ",
      }),
    ).toEqual({ ...valid, companyName: "Acme", country: "GB" });
  });

  it("sends null to clear an empty country", () => {
    expect(toProfileBody({ ...valid, country: "" }).country).toBeNull();
  });

  it("contains only the fields the API accepts", () => {
    expect(Object.keys(toProfileBody(valid)).sort()).toEqual([
      "companyDescription",
      "companyName",
      "companySize",
      "companyWebsite",
      "country",
      "industry",
      "professionalRole",
    ]);
  });
});

describe("industry mapping", () => {
  it("keeps a listed industry", () => {
    expect(splitIndustry("Education")).toEqual({
      selected: "Education",
      custom: "",
    });
  });

  it("maps an unlisted industry to Other", () => {
    expect(splitIndustry("Space mining")).toEqual({
      selected: "Other",
      custom: "Space mining",
    });
  });

  it("defaults an empty industry", () => {
    expect(splitIndustry("").selected).toBe("Software & technology");
  });

  it("resolves Other to the trimmed custom text", () => {
    expect(resolveIndustry("Other", "  Space mining ")).toBe("Space mining");
    expect(resolveIndustry("Education", "ignored")).toBe("Education");
  });
});

describe("profileToValues", () => {
  it("returns defaults when there is no profile yet", () => {
    expect(profileToValues(null)).toEqual(emptyProfileValues());
  });

  it("maps a null country to an empty string", () => {
    expect(profileToValues({ ...profile, country: null }).country).toBe("");
    expect(profileToValues(profile).country).toBe("US");
  });
});

describe("fieldErrorsFromApi", () => {
  it("maps errors onto form fields", () => {
    expect(
      fieldErrorsFromApi([
        { path: "companyName", message: "Company name is too long." },
        { path: "body.country", message: "Country is invalid." },
        { path: "unknown", message: "ignored" },
        { path: "companyName", message: "second ignored" },
      ]),
    ).toEqual({
      companyName: "Company name is too long.",
      country: "Country is invalid.",
    });
  });

  it("handles a missing list", () => {
    expect(fieldErrorsFromApi(undefined)).toEqual({});
    expect(hasFieldErrors({})).toBe(false);
    expect(hasFieldErrors({ country: "x" })).toBe(true);
  });
});

describe("mergeSavedProfile", () => {
  it("keeps joinedAt when the response has none", () => {
    const merged = mergeSavedProfile(profile, {
      ...profile,
      isOnboarded: true,
      joinedAt: null,
      companyName: "New",
    });
    expect(merged.companyName).toBe("New");
    expect(merged.joinedAt).toBe(profile.joinedAt);
    expect("isOnboarded" in merged).toBe(false);
  });
});

describe("money and dates", () => {
  it("formats cents without float math", () => {
    expect(formatBudgetCents(1999)).toBe("$19.99");
    expect(formatBudgetCents(0)).toBe("$0.00");
    expect(formatBudgetCents(123456789)).toBe("$1,234,567.89");
  });

  it("formats compact totals from cents", () => {
    expect(formatCompactCents(0)).toBe("$0");
    expect(formatCompactCents(1_250_000)).toBe("$12.5K");
    expect(formatCompactCents(250_000_000)).toBe("$2.5M");
  });

  it("reads the join year", () => {
    expect(joinedYear("2026-03-04T10:00:00.000Z")).toBe("2026");
    expect(joinedYear(null)).toBe("");
  });
});

describe("avatar copy", () => {
  it("derives the size message from the byte limit", () => {
    expect(AVATAR_SIZE_MESSAGE).toBe(
      `Profile photos must be ${AVATAR_MAX_BYTES / (1024 * 1024)} MB or smaller.`,
    );
  });
});
