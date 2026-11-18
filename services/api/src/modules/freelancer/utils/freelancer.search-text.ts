import {
  buildSearchText,
  countryDisplayName,
} from "../../../shared/search/search-text.js";

interface FreelancerSearchInput {
  displayName: string | null;
  professionalTitle: string;
  city: string;
  country: string;
  skills: readonly string[];
}

export const buildFreelancerSearchFields = (input: FreelancerSearchInput) => {
  const countryName = input.country ? countryDisplayName(input.country) : null;
  return {
    search_text: buildSearchText([
      input.displayName,
      input.professionalTitle,
      input.city,
      countryName,
      input.skills,
    ]),
    location_text: buildSearchText([input.city, countryName]),
  };
};
