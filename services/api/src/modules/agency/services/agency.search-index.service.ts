import { db } from "../../../database/client.js";
import {
  findAgencySearchSource,
  listAgencyOwnerIds as listOwnerIds,
  updateAgencySearchText,
} from "../repositories/agency.repository.js";
import { buildAgencySearchText } from "../utils/agency.search-text.js";

export const listAgencyOwnerIds = () => listOwnerIds(db);

export const rebuildAgencySearchText = async (
  ownerId: string,
  options: { dryRun?: boolean } = {},
): Promise<boolean> => {
  const source = await findAgencySearchSource(db, ownerId);
  if (!source) return false;

  const searchText = buildAgencySearchText({
    name: source.name,
    professionalTitle: source.professionalTitle,
    specialty: source.specialty,
    tags: source.tags,
  });

  const changed = searchText !== source.searchText;
  if (changed && !options.dryRun) {
    await updateAgencySearchText(db, ownerId, searchText);
  }
  return changed;
};
