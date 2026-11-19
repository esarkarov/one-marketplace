import { inArray } from "drizzle-orm";
import type { DbExecutor } from "@/database/database.types.js";
import { contract_milestones } from "@/modules/contracts/models/contracts.model.js";

export const findRecordedCheckoutSessionIds = async (
  executor: DbExecutor,
  sessionIds: string[],
): Promise<Set<string>> => {
  if (sessionIds.length === 0) return new Set();
  const rows = await executor
    .select({ sessionId: contract_milestones.stripe_checkout_session_id })
    .from(contract_milestones)
    .where(inArray(contract_milestones.stripe_checkout_session_id, sessionIds));
  const recorded = new Set<string>();
  for (const row of rows) {
    if (row.sessionId) recorded.add(row.sessionId);
  }
  return recorded;
};
