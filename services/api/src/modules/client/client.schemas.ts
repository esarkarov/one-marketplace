import { z } from "zod";

import {
  authRoleShape,
  optionalBoundedText,
  withIgnoredKeys,
} from "../../utils/common-schemas.js";
import { searchPagingShape } from "../../utils/search-schemas.js";
import { CLIENT_LIMITS } from "../../utils/validation-limits.js";

export const marketplaceSearchQuerySchema = z.strictObject({
  ...authRoleShape,
  ...searchPagingShape,
  type: z
    .string()
    .max(CLIENT_LIMITS.searchTypeMax, { error: "Type is invalid." })
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
  },
  ["id", "imageId", "createdAt", "updatedAt"],
);
