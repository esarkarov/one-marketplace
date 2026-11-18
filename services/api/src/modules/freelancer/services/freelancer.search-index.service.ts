import { db } from "../../../database/client.js";
import {
  findFreelancerSearchSource,
  listFreelancerAuthIds as listAuthIds,
  updateFreelancerSearchFields,
} from "../repositories/freelancer.repository.js";
import { buildFreelancerSearchFields } from "../utils/freelancer.search-text.js";

export const listFreelancerAuthIds = () => listAuthIds(db);

export const rebuildFreelancerSearchText = async (
  authId: string,
  options: { dryRun?: boolean } = {},
): Promise<boolean> => {
  const source = await findFreelancerSearchSource(db, authId);
  if (!source) return false;

  const fields = buildFreelancerSearchFields({
    displayName: source.displayName,
    professionalTitle: source.professionalTitle,
    city: source.city,
    country: source.country,
    skills: source.skills,
  });

  const changed =
    fields.search_text !== source.searchText ||
    fields.location_text !== source.locationText;
  if (changed && !options.dryRun) {
    await updateFreelancerSearchFields(db, authId, fields);
  }
  return changed;
};
