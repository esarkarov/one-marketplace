import { z } from "zod";

import {
  authRoleShape,
  boundedDataUrl,
  optionalBoundedText,
  pagingDigits,
  uuidParams,
  withIgnoredKeys,
} from "../../utils/common-schemas.js";
import { centsQueryParam } from "../../utils/money-schemas.js";
import { searchPagingShape } from "../../utils/search-schemas.js";
import {
  AGENCY_LIMITS,
  COMMON_LIMITS,
  JOB_LIMITS,
  MAX_LIVE_URL_LENGTH,
} from "../../utils/validation-limits.js";

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

const shortParam = (label: string) =>
  z
    .string()
    .max(JOB_LIMITS.feedSortMax, { error: `${label} is invalid.` })
    .optional();

export const agencyJobFeedQuerySchema = z.strictObject({
  ...authRoleShape,
  filter: shortParam("Filter"),
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
  sort: shortParam("Sort"),
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
  z.strictObject(
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
    { error: "Request body must be an object." },
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

const memberRoleField = z
  .string({ error: "Member role must be text." })
  .max(AGENCY_LIMITS.memberRoleMax, { error: "Member role is too long." });

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
