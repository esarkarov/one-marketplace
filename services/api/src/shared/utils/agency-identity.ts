import { eq } from "drizzle-orm";
import { db } from "../../database/client.js";
import { agency_members, agency_metadata } from "../../database/schema.js";

export const getAgencyIdentityForMember = async (
  freelancerId: string,
): Promise<{
  id: string;
  name: string;
  avatarUrl: string | null;
} | null> => {
  const [agency] = await db
    .select({
      id: agency_metadata.id,
      name: agency_metadata.name,
      avatarImage: agency_metadata.avatar_image,
    })
    .from(agency_members)
    .innerJoin(
      agency_metadata,
      eq(agency_metadata.id, agency_members.agency_id),
    )
    .where(eq(agency_members.freelancer_id, freelancerId))
    .limit(1);

  if (!agency) return null;
  return {
    id: agency.id,
    name: agency.name,
    avatarUrl: agency.avatarImage?.url ?? null,
  };
};
