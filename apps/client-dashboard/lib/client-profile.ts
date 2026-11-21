import type { ApiFieldError, Components } from "@onemarketplace/api-client";
import { centsToDollarsString, formatCents } from "@onemarketplace/api-client";

export type ClientProfile = Components["schemas"]["ClientProfile"];
export type ClientProfileSaved = Components["schemas"]["ClientProfileSaved"];

export const CLIENT_PROFILE_LIMITS = {
  professionalRole: 100,
  companyName: 100,
  industry: 100,
  companySize: 50,
  companyDescription: 5000,
  companyWebsite: 2048,
} as const;

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_SIZE_MESSAGE = `Profile photos must be ${AVATAR_MAX_BYTES / (1024 * 1024)} MB or smaller.`;

export const INDUSTRY_OPTIONS = [
  "Healthcare technology",
  "Software & technology",
  "Financial services",
  "Retail & e-commerce",
  "Education",
  "Media & entertainment",
  "Professional services",
  "Manufacturing",
  "Real estate",
  "Nonprofit",
] as const;

export const OTHER_INDUSTRY = "Other";

export const COMPANY_SIZE_OPTIONS = [
  "Just me",
  "2–10 employees",
  "11–50 employees",
  "51–200 employees",
  "201–500 employees",
  "501–1,000 employees",
  "1,001–5,000 employees",
  "5,001+ employees",
] as const;

export const PROFILE_NOT_FOUND_CODE = "PROFILE_NOT_FOUND";

export type ClientProfileField =
  | "professionalRole"
  | "companyName"
  | "companyWebsite"
  | "companySize"
  | "industry"
  | "companyDescription"
  | "country";

export interface ClientProfileValues {
  professionalRole: string;
  companyName: string;
  companyWebsite: string;
  companySize: string;
  industry: string;
  companyDescription: string;
  country: string;
}

export type ClientProfileFieldErrors = Partial<
  Record<ClientProfileField, string>
>;

export type ClientProfileBody = {
  professionalRole: string;
  companyName: string;
  companyWebsite: string;
  companySize: string;
  industry: string;
  companyDescription: string;
  country: string | null;
};

const FIELDS: readonly ClientProfileField[] = [
  "professionalRole",
  "companyName",
  "companyWebsite",
  "companySize",
  "industry",
  "companyDescription",
  "country",
];

const LABELS: Record<ClientProfileField, string> = {
  professionalRole: "Role",
  companyName: "Company name",
  companyWebsite: "Company website",
  companySize: "Company size",
  industry: "Industry",
  companyDescription: "Company description",
  country: "Location",
};

const REQUIRED: readonly ClientProfileField[] = [
  "professionalRole",
  "companyName",
  "companyWebsite",
  "companySize",
  "industry",
  "companyDescription",
  "country",
];

const COUNTRY_CODE = /^[A-Z]{2}$/;

export const emptyProfileValues = (): ClientProfileValues => ({
  professionalRole: "",
  companyName: "",
  companyWebsite: "",
  companySize: COMPANY_SIZE_OPTIONS[0],
  industry: INDUSTRY_OPTIONS[1],
  companyDescription: "",
  country: "",
});

export const profileToValues = (
  profile: ClientProfile | null | undefined,
): ClientProfileValues => {
  const base = emptyProfileValues();
  if (!profile) return base;
  return {
    professionalRole: profile.professionalRole,
    companyName: profile.companyName,
    companyWebsite: profile.companyWebsite,
    companySize: profile.companySize || base.companySize,
    industry: profile.industry || base.industry,
    companyDescription: profile.companyDescription,
    country: profile.country ?? "",
  };
};

export const splitIndustry = (
  saved: string,
): { selected: string; custom: string } => {
  if (!saved) return { selected: INDUSTRY_OPTIONS[1], custom: "" };
  if (INDUSTRY_OPTIONS.some((option) => option === saved)) {
    return { selected: saved, custom: "" };
  }
  return { selected: OTHER_INDUSTRY, custom: saved };
};

export const resolveIndustry = (selected: string, custom: string): string =>
  selected === OTHER_INDUSTRY ? custom.trim() : selected.trim();

export const isValidWebsite = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.hostname.length > 0
    );
  } catch {
    return false;
  }
};

export const normalizeProfileValues = (
  values: ClientProfileValues,
): ClientProfileValues => ({
  professionalRole: values.professionalRole.trim(),
  companyName: values.companyName.trim(),
  companyWebsite: values.companyWebsite.trim(),
  companySize: values.companySize.trim(),
  industry: values.industry.trim(),
  companyDescription: values.companyDescription.trim(),
  country: values.country.trim().toUpperCase(),
});

export const validateProfileValues = (
  input: ClientProfileValues,
  knownCountries?: ReadonlySet<string>,
): ClientProfileFieldErrors => {
  const values = normalizeProfileValues(input);
  const errors: ClientProfileFieldErrors = {};

  for (const field of REQUIRED) {
    if (values[field].length === 0) errors[field] = "This field is required.";
  }

  for (const field of FIELDS) {
    if (field === "country" || errors[field]) continue;
    const max = CLIENT_PROFILE_LIMITS[field];
    if (values[field].length > max) {
      errors[field] = `${LABELS[field]} must be at most ${max} characters.`;
    }
  }

  if (!errors.companyWebsite && !isValidWebsite(values.companyWebsite)) {
    errors.companyWebsite = "Enter a full URL, like https://example.com.";
  }

  if (
    !errors.country &&
    (!COUNTRY_CODE.test(values.country) ||
      (knownCountries && !knownCountries.has(values.country)))
  ) {
    errors.country = "Select your country.";
  }

  return errors;
};

export const toProfileBody = (
  input: ClientProfileValues,
): ClientProfileBody => {
  const values = normalizeProfileValues(input);
  return {
    professionalRole: values.professionalRole,
    companyName: values.companyName,
    companyWebsite: values.companyWebsite,
    companySize: values.companySize,
    industry: values.industry,
    companyDescription: values.companyDescription,
    country: values.country.length > 0 ? values.country : null,
  };
};

const isField = (value: string): value is ClientProfileField =>
  FIELDS.some((field) => field === value);

export const fieldErrorsFromApi = (
  errors: readonly ApiFieldError[] | undefined,
): ClientProfileFieldErrors => {
  const result: ClientProfileFieldErrors = {};
  for (const item of errors ?? []) {
    const name = item.path.split(".").pop() ?? "";
    if (isField(name) && !result[name]) result[name] = item.message;
  }
  return result;
};

export const hasFieldErrors = (errors: ClientProfileFieldErrors): boolean =>
  Object.keys(errors).length > 0;

export const mergeSavedProfile = (
  current: ClientProfile | null | undefined,
  saved: ClientProfileSaved,
): ClientProfile => ({
  companyDescription: saved.companyDescription,
  companyName: saved.companyName,
  companySize: saved.companySize,
  companyWebsite: saved.companyWebsite,
  country: saved.country,
  identityVerified: saved.identityVerified,
  industry: saved.industry,
  joinedAt: saved.joinedAt ?? current?.joinedAt ?? null,
  paymentMethodVerified: saved.paymentMethodVerified,
  professionalRole: saved.professionalRole,
});

export const formatCompactCents = (cents: number): string => {
  const dollars = Number(centsToDollarsString(cents));
  return `$${new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(dollars)}`;
};

export const formatBudgetCents = (cents: number): string => formatCents(cents);

export const joinedYear = (joinedAt: string | null | undefined): string =>
  joinedAt ? joinedAt.slice(0, 4) : "";
