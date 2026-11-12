import { eq } from "drizzle-orm";
import { conversation_participants } from "../../../database/schema.js";

export const participantMatch = (
  accountId: string,
  agencyId?: string | null,
) =>
  agencyId
    ? eq(conversation_participants.agency_id, agencyId)
    : eq(conversation_participants.account_id, accountId);
