import { and, eq, inArray } from "drizzle-orm";
import { logger } from "../src/config/logger.js";
import { db } from "../src/database/client.js";
import {
  agency_metadata,
  conversation_participants,
  conversations,
  proposals,
} from "../src/database/schema.js";
import { getAgencyOwnerId } from "../src/modules/agency/agency.service.js";

// One-off migration cleanup: conversation_participants used to store one row
// per agency team member (account_id = that member's real auth_id). The
// schema now has a dedicated nullable agency_id column so an agency
// conversation needs exactly one shared row instead — this collapses any
// pre-existing per-member rows (participant_type = 'AGENCY', account_id set)
// down to a single row tagged with agency_id. Safe to re-run: a conversation
// already collapsed has only one AGENCY row left, so there's nothing to do.
const run = async () => {
  const legacyRows = await db
    .select({
      id: conversation_participants.id,
      conversationId: conversation_participants.conversation_id,
      accountId: conversation_participants.account_id,
    })
    .from(conversation_participants)
    .where(eq(conversation_participants.participant_type, "AGENCY"));

  const byConversation = new Map<string, typeof legacyRows>();
  for (const row of legacyRows) {
    if (!row.accountId) continue; // already collapsed
    const group = byConversation.get(row.conversationId) ?? [];
    group.push(row);
    byConversation.set(row.conversationId, group);
  }

  let collapsed = 0;
  for (const [conversationId, rows] of byConversation) {
    if (rows.length < 1) continue;

    const [proposal] = await db
      .select({ agencyId: proposals.sender_id })
      .from(conversations)
      .innerJoin(proposals, eq(proposals.id, conversations.proposal_id))
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(proposals.sender_type, "AGENCY"),
        ),
      )
      .limit(1);
    if (!proposal) {
      await logger.warn({
        message: "No AGENCY proposal found, skipping conversation",
        eventName: "script.collapse.skipped",
        attributes: { "conversation.id": String(conversationId) },
      });
      continue;
    }

    const [agency] = await db
      .select({ name: agency_metadata.name })
      .from(agency_metadata)
      .where(eq(agency_metadata.id, proposal.agencyId))
      .limit(1);

    const ownerId = await getAgencyOwnerId(proposal.agencyId);
    const keeper = rows.find((row) => row.accountId === ownerId) ?? rows[0]!;
    const toDelete = rows.filter((row) => row.id !== keeper.id);

    await db.transaction(async (transaction) => {
      if (toDelete.length) {
        await transaction.delete(conversation_participants).where(
          inArray(
            conversation_participants.id,
            toDelete.map((row) => row.id),
          ),
        );
      }
      await transaction
        .update(conversation_participants)
        .set({ account_id: null, agency_id: proposal.agencyId })
        .where(eq(conversation_participants.id, keeper.id));
    });

    await logger.info({
      message: "Collapsed agency participant rows",
      eventName: "script.collapse.done",
      attributes: {
        "agency.id": String(proposal.agencyId),
        "agency.name": agency?.name ?? null,
        "conversation.id": String(conversationId),
        "rows.collapsed": rows.length,
      },
    });
    collapsed += 1;
  }

  await logger.info({
    message: "Collapse finished",
    eventName: "script.collapse.finished",
    attributes: { "conversations.collapsed": collapsed },
  });
  process.exit(0);
};

run().catch(async (error) => {
  await logger.error({
    message: "Collapse script failed",
    eventName: "script.collapse.failed",
    attributes: {
      "error.name": error instanceof Error ? error.name : "UnknownError",
      "error.message": error instanceof Error ? error.message : String(error),
    },
  });
  process.exit(1);
});
