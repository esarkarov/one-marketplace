import { z } from "zod";
import type { RequestSchemas } from "../../../middleware/types/validate.types.js";

import {
  authRoleShape,
  optionalBoundedText,
  withIgnoredKeys,
} from "../../../shared/validation/schemas/common.schema.js";
import { roleListQuerySchema } from "../../../shared/validation/schemas/pagination.schema.js";
import { countryCodeSchema } from "../../../shared/validation/schemas/country.schema.js";
import { searchPagingShape } from "../../../shared/validation/schemas/search.schema.js";
import { CLIENT_LIMITS } from "../constants/client.constants.js";

export const marketplaceSearchQuerySchema = z.strictObject({
  ...authRoleShape,
  ...searchPagingShape,
  type: z
    .enum(["all", "freelancer", "agency"], { error: "Type is invalid." })
    .optional(),
});

export const clientProfileBodySchema = withIgnoredKeys(
  {
    ...authRoleShape,
    professionalRole: optionalBoundedText(
      "Professional role",
      CLIENT_LIMITS.professionalRoleMax,
    ).optional(),
    companyName: optionalBoundedText(
      "Company name",
      CLIENT_LIMITS.companyNameMax,
    ).optional(),
    companyWebsite: z
      .string({ error: "Company website must be text." })
      .max(CLIENT_LIMITS.websiteMax, { error: "Company website is too long." })
      .optional(),
    companySize: optionalBoundedText(
      "Company size",
      CLIENT_LIMITS.companySizeMax,
    ).optional(),
    industry: optionalBoundedText(
      "Industry",
      CLIENT_LIMITS.industryMax,
    ).optional(),
    companyDescription: optionalBoundedText(
      "Company description",
      CLIENT_LIMITS.companyDescriptionMax,
    ).optional(),
    country: countryCodeSchema.nullable().optional(),
  },
  ["id", "imageId", "createdAt", "updatedAt"],
);

export const clientProfileRequest = {
  query: authRoleShape,
  body: clientProfileBodySchema,
} satisfies RequestSchemas;

export const clientCompletedContractsRequest = {
  query: roleListQuerySchema,
} satisfies RequestSchemas;

export const marketplaceSearchRequest = {
  query: marketplaceSearchQuerySchema,
} satisfies RequestSchemas;
