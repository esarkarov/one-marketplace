import { z } from "zod";
import {
  COUNTRY_CODE_PATTERN,
  UNKNOWN_REGION_CODE,
} from "../constants/country.constants.js";

const knownRegions = new Intl.DisplayNames(["en"], {
  type: "region",
  fallback: "none",
});

const isKnownRegion = (code: string): boolean => {
  if (code === UNKNOWN_REGION_CODE) return false;
  try {
    return knownRegions.of(code) !== undefined;
  } catch {
    return false;
  }
};

export const countryCodeSchema = z
  .string({ error: "Country must be text." })
  .regex(COUNTRY_CODE_PATTERN, {
    error: "Country must be an uppercase ISO 3166-1 alpha-2 code.",
  })
  .refine(isKnownRegion, { error: "Country is not a known region." })
  .describe("ISO 3166-1 alpha-2 country code, uppercase.");
