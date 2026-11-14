import { db } from "../../database/client.js";
import { findAgencyIdentityOfMember } from "./freelancer.repository.js";

export const getAgencyIdentityForMember = async (
  freelancerId: string,
): Promise<{
  id: string;
  name: string;
  avatarUrl: string | null;
} | null> => {
  const agency = await findAgencyIdentityOfMember(db, freelancerId);

  if (!agency) return null;
  return {
    id: agency.id,
    name: agency.name,
    avatarUrl: agency.avatarImage?.url ?? null,
  };
};
