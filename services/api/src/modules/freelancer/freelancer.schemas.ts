import { z } from "zod";

import {
  authRoleShape,
  boundedDataUrl,
  optionalBoundedText,
  pagingDigits,
  uuidParams,
  withIgnoredKeys,
} from "../../utils/common-schemas.js";
import { moneyCents } from "../../utils/money.js";
import { centsQueryParam } from "../../utils/money-schemas.js";
import { searchPagingShape } from "../../utils/search-schemas.js";
import {
  FREELANCER_LIMITS,
  JOB_LIMITS,
  MAX_LIVE_URL_LENGTH,
} from "../../utils/validation-limits.js";

export const MIN_HOURLY_RATE_CENTS = 500;
export const MAX_HOURLY_RATE_CENTS = 100_000;

const IGNORED_KEYS = ["id", "imageId", "createdAt", "updatedAt"] as const;

const SKILLS_ERROR = `Add ${FREELANCER_LIMITS.skillsMinItems} to ${FREELANCER_LIMITS.skillsMaxItems} skills with at most ${FREELANCER_LIMITS.skillMaxLength} characters each.`;
const LANGUAGES_ERROR = `Add between ${FREELANCER_LIMITS.languagesMinItems} and ${FREELANCER_LIMITS.languagesMaxItems} languages.`;

const skillSchema = z
  .string({ error: SKILLS_ERROR })
  .trim()
  .min(1, { error: SKILLS_ERROR })
  .max(FREELANCER_LIMITS.skillMaxLength, { error: SKILLS_ERROR });

const languageSchema = z.strictObject(
  {
    language: optionalBoundedText(
      "Language",
      FREELANCER_LIMITS.languageMax,
    ).optional(),
    proficiency: optionalBoundedText(
      "Language proficiency",
      FREELANCER_LIMITS.proficiencyMax,
    ).optional(),
  },
  { error: "Each language must be an object." },
);

const coverImageSchema = withIgnoredKeys(
  {
    url: boundedDataUrl("Portfolio cover image").optional(),
  },
  IGNORED_KEYS,
);

const portfolioSchema = withIgnoredKeys(
  {
    title: optionalBoundedText(
      "Portfolio title",
      FREELANCER_LIMITS.portfolioTitleMax,
    ).optional(),
    category: optionalBoundedText(
      "Portfolio category",
      FREELANCER_LIMITS.portfolioCategoryMax,
    ).optional(),
    description: optionalBoundedText(
      "Portfolio description",
      FREELANCER_LIMITS.portfolioDescriptionMax,
    ).optional(),
    live_url: z
      .string({ error: "Live URL must be text." })
      .max(MAX_LIVE_URL_LENGTH, { error: "Live URL is too long." })
      .nullish(),
    cover_image: coverImageSchema.optional(),
  },
  IGNORED_KEYS,
);

const metadataSchema = withIgnoredKeys(
  {
    professional_title: optionalBoundedText(
      "Professional title",
      FREELANCER_LIMITS.professionalTitleMax,
    ).optional(),
    professional_description: optionalBoundedText(
      "Professional description",
      FREELANCER_LIMITS.professionalDescriptionMax,
    ).optional(),
    hourly_rate_cents: moneyCents
      .min(MIN_HOURLY_RATE_CENTS, {
        error: "Hourly rate must be between 5 and 1000$.",
      })
      .max(MAX_HOURLY_RATE_CENTS, {
        error: "Hourly rate must be between 5 and 1000$.",
      }),
    country: optionalBoundedText(
      "Country",
      FREELANCER_LIMITS.countryMax,
    ).optional(),
    city: optionalBoundedText("City", FREELANCER_LIMITS.cityMax).optional(),
    availability_status: optionalBoundedText(
      "Availability status",
      FREELANCER_LIMITS.availabilityMax,
    ).optional(),
    weekly_availability: optionalBoundedText(
      "Weekly availability",
      FREELANCER_LIMITS.weeklyAvailabilityMax,
    ).optional(),
    experience_level: optionalBoundedText(
      "Experience level",
      FREELANCER_LIMITS.experienceLevelMax,
    ).optional(),
    skills: z
      .array(skillSchema, { error: SKILLS_ERROR })
      .min(FREELANCER_LIMITS.skillsMinItems, { error: SKILLS_ERROR })
      .max(FREELANCER_LIMITS.skillsMaxItems, { error: SKILLS_ERROR })
      .optional(),
    languages: z
      .array(languageSchema, { error: LANGUAGES_ERROR })
      .min(FREELANCER_LIMITS.languagesMinItems, { error: LANGUAGES_ERROR })
      .max(FREELANCER_LIMITS.languagesMaxItems, { error: LANGUAGES_ERROR })
      .optional(),
  },
  IGNORED_KEYS,
);

export const upsertProfileBodySchema = withIgnoredKeys(
  {
    ...authRoleShape,
    freelancer_metadata: metadataSchema,
    freelancer_portfolios: z
      .array(portfolioSchema, {
        error: "At least one portfolio project is required.",
      })
      .max(FREELANCER_LIMITS.portfolioMaxItems, {
        error: `At most ${FREELANCER_LIMITS.portfolioMaxItems} portfolio projects are allowed.`,
      })
      .optional(),
  },
  IGNORED_KEYS,
);

export const idParamsSchema = uuidParams("id");

const listParam = z
  .string()
  .max(JOB_LIMITS.feedLevelsMax, { error: "Filter is too long." })
  .optional();

const booleanParam = z
  .enum(["true", "false"], { error: "Filter must be true or false." })
  .optional();

const decimalParam = (label: string) =>
  z
    .string()
    .max(FREELANCER_LIMITS.decimalFilterMax, { error: `${label} is invalid.` })
    .regex(/^\d+(\.\d+)?$/, { error: `${label} is invalid.` })
    .optional();

export const jobFeedQuerySchema = z.strictObject({
  ...authRoleShape,
  filter: z
    .enum(["best-match", "recent"], { error: "Filter is invalid." })
    .optional(),
  levels: listParam,
  durations: listParam,
  paymentVerified: booleanParam,
  minBudgetCents: centsQueryParam,
  maxBudgetCents: centsQueryParam,
  minProposals: pagingDigits("Minimum proposals").optional(),
  maxProposals: pagingDigits("Maximum proposals").optional(),
});

export const talentSearchQuerySchema = z.strictObject({
  ...searchPagingShape,
  sort: z
    .enum(["recommended", "rating", "success", "projects", "rate-low"], {
      error: "Sort is invalid.",
    })
    .optional(),
  verifiedOnly: booleanParam,
  availableOnly: booleanParam,
  minRating: decimalParam("Minimum rating"),
  minSuccess: decimalParam("Minimum success"),
  minRateCents: centsQueryParam,
  maxRateCents: centsQueryParam,
});
