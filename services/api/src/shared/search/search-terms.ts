export const MAX_SEARCH_TERMS = 10;

export const toSearchTerms = (query: string | null | undefined): string[] =>
  (query ?? "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term !== "")
    .slice(0, MAX_SEARCH_TERMS);

export const escapeLikePattern = (term: string): string =>
  term.replace(/[\\%_]/g, (character) => `\\${character}`);
