import { ApiError } from "../../errors/api-error.js";

export const requireText = (
  value: string | string[] | null | undefined,
  fieldName: string,
): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(400, `${fieldName} is required.`);
  }

  return value.trim();
};

export const requireWebsite = (value: string | null | undefined): string => {
  const website = requireText(value, "Company website");

  try {
    const url = new URL(website);

    if (url.protocol !== "https:") {
      throw new Error("Unsupported protocol.");
    }
  } catch {
    throw new ApiError(400, "Company website must be a valid HTTP URL.");
  }

  return website;
};
