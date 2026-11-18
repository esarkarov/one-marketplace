type SearchTextPart = string | readonly string[] | null | undefined;

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

export const countryDisplayName = (code: string): string => {
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
};

export const buildSearchText = (parts: readonly SearchTextPart[]): string =>
  parts
    .flatMap((part) => (Array.isArray(part) ? part : [part]))
    .map((part) => (part ?? "").toLowerCase().replace(/\s+/g, " ").trim())
    .filter((part) => part !== "")
    .join(" ");
