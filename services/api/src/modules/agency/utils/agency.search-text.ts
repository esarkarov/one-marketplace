import { buildSearchText } from "../../../shared/search/search-text.js";

interface AgencySearchInput {
  name: string;
  professionalTitle: string | null | undefined;
  specialty: string;
  tags: readonly string[] | null | undefined;
}

export const buildAgencySearchText = (input: AgencySearchInput): string =>
  buildSearchText([
    input.name,
    input.professionalTitle,
    input.specialty,
    input.tags,
  ]);
