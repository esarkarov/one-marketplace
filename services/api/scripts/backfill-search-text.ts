import { logger } from "../src/config/logger.js";
import {
  listAgencyOwnerIds,
  rebuildAgencySearchText,
} from "../src/modules/agency/index.js";
import { syncAccountDisplay } from "../src/modules/auth/index.js";
import {
  listFreelancerAuthIds,
  rebuildFreelancerSearchText,
} from "../src/modules/freelancer/index.js";

// Rebuilds accounts.display_name/avatar_url (from Clerk) and the search_text
// and location_text columns of freelancer and agency profiles. Idempotent:
// rows whose rebuilt value is unchanged are left untouched.
// Usage: tsx --env-file=../../.env scripts/backfill-search-text.ts [--dry-run]
const dryRun = process.argv.includes("--dry-run");

const run = async () => {
  const freelancerIds = await listFreelancerAuthIds();
  const agencyOwnerIds = await listAgencyOwnerIds();
  const accountIds = [...new Set([...freelancerIds, ...agencyOwnerIds])];

  let displaySynced = 0;
  if (!dryRun) {
    for (const authId of accountIds) {
      await syncAccountDisplay(authId);
      displaySynced += 1;
    }
  }

  let freelancersChanged = 0;
  for (const authId of freelancerIds) {
    if (await rebuildFreelancerSearchText(authId, { dryRun })) {
      freelancersChanged += 1;
    }
  }

  let agenciesChanged = 0;
  for (const ownerId of agencyOwnerIds) {
    if (await rebuildAgencySearchText(ownerId, { dryRun })) {
      agenciesChanged += 1;
    }
  }

  await logger.info({
    message: dryRun ? "Search text backfill dry run" : "Search text backfill",
    eventName: "script.backfill_search_text.finished",
    attributes: {
      dry_run: dryRun,
      "accounts.total": accountIds.length,
      "accounts.display_synced": displaySynced,
      "freelancers.total": freelancerIds.length,
      "freelancers.changed": freelancersChanged,
      "agencies.total": agencyOwnerIds.length,
      "agencies.changed": agenciesChanged,
    },
  });
  process.exit(0);
};

run().catch(async (error) => {
  await logger.error({
    message: "Search text backfill failed",
    eventName: "script.backfill_search_text.failed",
    attributes: {
      "error.name": error instanceof Error ? error.name : "UnknownError",
    },
  });
  process.exit(1);
});
