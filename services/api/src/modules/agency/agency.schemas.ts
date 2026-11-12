import { z } from "zod";

import {
  authRoleShape,
  boundedDataUrl,
  optionalBoundedText,
  pagingDigits,
  uuidParams,
  withIgnoredKeys,
} from "../../shared/validation/common-schemas.js";
import { centsQueryParam } from "../../shared/validation/money-schemas.js";
import { searchPagingShape } from "../../shared/validation/search-schemas.js";
import {
  AGENCY_LIMITS,
  COMMON_LIMITS,
  JOB_LIMITS,
  MAX_LIVE_URL_LENGTH,
} from "../../shared/validation/validation-limits.js";

const optionalBody = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => value ?? {}, schema);

const IGNORED_KEYS = ["id", "imageId", "createdAt", "updatedAt"] as const;

const listParam = z
  .string()
  .max(JOB_LIMITS.feedLevelsMax, { error: "Filter is too long." })
  .optional();

const booleanParam = z
  .enum(["true", "false"], { error: "Filter must be true or false." })
  .optional();

export const agencyJobFeedQuerySchema = z.strictObject({
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

export const agencyTalentSearchQuerySchema = z.strictObject({
  ...searchPagingShape,
  sort: z
    .enum(["recommended", "rating", "projects", "rate-low"], {
      error: "Sort is invalid.",
    })
    .optional(),
  sizes: listParam,
  specialty: z
    .string()
    .max(AGENCY_LIMITS.specialtyMax, { error: "Specialty is too long." })
    .optional(),
  verifiedOnly: booleanParam,
  maxRateCents: centsQueryParam,
});

export const publicAgencyParamsSchema = uuidParams("id");
export const invitationParamsSchema = uuidParams("invitationId");
export const memberParamsSchema = uuidParams("memberId");

const websiteField = z
  .string({ error: "Agency website must be text." })
  .max(AGENCY_LIMITS.websiteMax, { error: "Agency website is too long." })
  .nullish();

export const createAgencyBodySchema = optionalBody(
  withIgnoredKeys(
    {
      ...authRoleShape,
      name: optionalBoundedText("Agency name", AGENCY_LIMITS.nameMax).nullish(),
      size: optionalBoundedText("Agency size", AGENCY_LIMITS.sizeMax).nullish(),
      specialty: optionalBoundedText(
        "Primary specialty",
        AGENCY_LIMITS.specialtyMax,
      ).nullish(),
      website: websiteField,
      overview: optionalBoundedText(
        "Agency overview",
        AGENCY_LIMITS.overviewMax,
      ).nullish(),
    },
    IGNORED_KEYS,
  ),
);

const imageSchema = (label: string) =>
  withIgnoredKeys({ url: boundedDataUrl(label).nullish() }, IGNORED_KEYS);

const portfolioItemSchema = withIgnoredKeys(
  {
    title: optionalBoundedText(
      "Portfolio project title",
      AGENCY_LIMITS.portfolioTitleMax,
    ).nullish(),
    category: optionalBoundedText(
      "Portfolio project category",
      AGENCY_LIMITS.portfolioCategoryMax,
    ).nullish(),
    description: optionalBoundedText(
      "Portfolio project description",
      AGENCY_LIMITS.portfolioDescriptionMax,
    ).nullish(),
    liveUrl: z
      .string({ error: "Live URL must be text." })
      .max(MAX_LIVE_URL_LENGTH, { error: "Live URL is too long." })
      .nullish(),
    coverImage: imageSchema("Portfolio cover image").nullish(),
  },
  IGNORED_KEYS,
);

export const updateAgencyBodySchema = withIgnoredKeys(
  {
    ...authRoleShape,
    name: optionalBoundedText("Agency name", AGENCY_LIMITS.nameMax).nullish(),
    professionalTitle: optionalBoundedText(
      "Profile title",
      AGENCY_LIMITS.professionalTitleMax,
    ).nullish(),
    size: optionalBoundedText("Agency size", AGENCY_LIMITS.sizeMax).nullish(),
    specialty: optionalBoundedText(
      "Primary specialty",
      AGENCY_LIMITS.specialtyMax,
    ).nullish(),
    website: websiteField,
    overview: optionalBoundedText(
      "Profile description",
      AGENCY_LIMITS.overviewMax,
    ).nullish(),
    tags: z
      .array(optionalBoundedText("Tag", AGENCY_LIMITS.tagMaxLength), {
        error: "Tags must be an array.",
      })
      .max(AGENCY_LIMITS.tagsMaxItems, { error: "Too many tags." })
      .nullish(),
    avatarImage: imageSchema("Avatar image").nullish(),
    portfolio: z
      .array(portfolioItemSchema, { error: "Portfolio must be an array." })
      .max(AGENCY_LIMITS.portfolioMaxItems, {
        error: "Too many portfolio projects.",
      })
      .nullish(),
  },
  IGNORED_KEYS,
);

export const connectsCheckoutBodySchema = z.strictObject({
  ...authRoleShape,
  connects: z.number({ error: "Select a valid Connects package." }),
});

const memberRoleField = z.enum(["Agency member", "Business manager"], {
  error: "Member role is invalid.",
});

export const inviteMemberBodySchema = z.strictObject({
  ...authRoleShape,
  email: z
    .string({ error: "Email must be text." })
    .max(COMMON_LIMITS.email, { error: "Email is too long." })
    .optional(),
  memberRole: memberRoleField.optional(),
});

export const memberRoleBodySchema = optionalBody(
  z.strictObject({
    ...authRoleShape,
    memberRole: memberRoleField.optional(),
  }),
);

export const respondInvitationBodySchema = optionalBody(
  z.strictObject({
    ...authRoleShape,
    accept: z.boolean({ error: "Accept must be true or false." }).optional(),
  }),
);
