import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { EARNINGS_HOLD_PERIOD_MS } from "../../config/constants.js";
import { db, pool } from "../../database/client.js";
import {
  accounts,
  agency_metadata,
  contract_milestones,
  contracts,
  earning_history,
  job_posts,
  payout_history,
  proposals,
} from "../../database/schema.js";
import { assertTestDatabase } from "../setup/assert-test-database.js";

export const TEST_PREFIX = "payout-it-";

export type Owner =
  | { freelancerId: string; agencyId?: undefined }
  | { agencyId: string; freelancerId?: undefined };

export type PayoutSeed = {
  status?: "PENDING" | "PROCESSING" | "PAID" | "FAILED";
  amountCents?: number;
  attempts?: number;
  claimedMinutesAgo?: number;
  nextRetryInSeconds?: number;
  idempotencyKey?: string;
  stripeTransferId?: string;
  notified?: boolean;
  lastError?: string;
  destinationAccountId?: string;
};

export const assertPayoutSchema = async () => {
  assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);
  const result = await pool.query(
    "select 1 from information_schema.columns where table_name = 'payout_history' and column_name = 'status'",
  );
  if (result.rowCount === 0) {
    throw new Error(
      "payout_history.status is missing in the test database. Run: pnpm --filter @onemarketplace/api db:test:migrate",
    );
  }
};

export const readPayout = async (id: string) => {
  const [row] = await db
    .select()
    .from(payout_history)
    .where(eq(payout_history.id, id));
  return row;
};

export const findPayoutsByEarning = (earningId: string) =>
  db
    .select()
    .from(payout_history)
    .where(eq(payout_history.earning_history_id, earningId));

export const timeTravel = async (
  id: string,
  patch: {
    claimedMinutesAgo?: number;
    nextRetryInSeconds?: number;
    createdMinutesAgo?: number;
  },
) => {
  const set: Record<string, unknown> = {};
  if (patch.claimedMinutesAgo !== undefined) {
    set.claimed_at = sql`now() - ${patch.claimedMinutesAgo}::int * interval '1 minute'`;
  }
  if (patch.nextRetryInSeconds !== undefined) {
    set.next_retry_at = sql`now() + ${patch.nextRetryInSeconds}::int * interval '1 second'`;
  }
  if (patch.createdMinutesAgo !== undefined) {
    set.created_at = sql`now() - ${patch.createdMinutesAgo}::int * interval '1 minute'`;
  }
  await db.update(payout_history).set(set).where(eq(payout_history.id, id));
};

export const secondsUntilRetry = async (id: string) => {
  const result = await pool.query<{ seconds: string | null }>(
    "select extract(epoch from (next_retry_at - now())) as seconds from payout_history where id = $1",
    [id],
  );
  const value = result.rows[0]?.seconds;
  return value === null || value === undefined ? null : Number(value);
};

export const countLeftovers = async () => {
  const result = await pool.query<{ total: string }>(
    `select (
       (select count(*) from accounts where auth_id like $1) +
       (select count(*) from agency_metadata where owner_id like $1) +
       (select count(*) from contracts where client_id like $1) +
       (select count(*) from earning_history where freelancer_id like $1) +
       (select count(*) from payout_history where freelancer_id like $1)
     )::text as total`,
    [`${TEST_PREFIX}%`],
  );
  return Number(result.rows[0]?.total ?? 0);
};

export const purgeLeftovers = async (prefix: string = TEST_PREFIX) => {
  const like = `${prefix}%`;
  await pool.query("delete from contracts where client_id like $1", [like]);
  await pool.query("delete from proposals where sender_id like $1", [like]);
  await pool.query("delete from job_posts where client_id like $1", [like]);
  await pool.query("delete from agency_metadata where owner_id like $1", [
    like,
  ]);
  await pool.query("delete from accounts where auth_id like $1", [like]);
};

export const createTestData = (prefix: string = TEST_PREFIX) => {
  assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);

  const created = {
    accountIds: [] as string[],
    agencyIds: [] as string[],
    jobIds: [] as string[],
    proposalIds: [] as string[],
    contractIds: [] as string[],
    earningIds: [] as string[],
  };
  let clientAuthId: string | undefined;

  const insertAccount = async (
    role: "FREELANCER" | "CLIENT",
    connectAccountId: string | null,
  ) => {
    const authId = `${prefix}${randomUUID()}`;
    await db.insert(accounts).values({
      auth_id: authId,
      email: `${authId}@example.test`,
      role,
      stripe_connect_account_id: connectAccountId,
      created_at: new Date(),
      updated_at: new Date(),
    });
    created.accountIds.push(authId);
    return authId;
  };

  const ensureClient = async () => {
    clientAuthId ??= await insertAccount("CLIENT", null);
    return clientAuthId;
  };

  const createFreelancer = async (
    options: { connectAccount?: boolean } = {},
  ) => {
    const connectAccountId =
      options.connectAccount === false ? null : `acct_it_${randomUUID()}`;
    const authId = await insertAccount("FREELANCER", connectAccountId);
    return { authId, connectAccountId };
  };

  const createAgency = async (options: { connectAccount?: boolean } = {}) => {
    const ownerAuthId = await insertAccount("FREELANCER", null);
    const connectAccountId =
      options.connectAccount === false ? null : `acct_it_${randomUUID()}`;
    const [agency] = await db
      .insert(agency_metadata)
      .values({
        owner_id: ownerAuthId,
        name: `${prefix}agency-${randomUUID()}`,
        size: "1-10",
        specialty: "testing",
        overview: "integration test agency",
        stripe_connect_account_id: connectAccountId,
      })
      .returning({ id: agency_metadata.id });
    created.agencyIds.push(agency!.id);
    return { agencyId: agency!.id, ownerAuthId, connectAccountId };
  };

  const createEarning = async (
    owner: Owner,
    options: { amountCents?: number; feeCents?: number; ageMs?: number } = {},
  ) => {
    const amountCents = options.amountCents ?? 11000;
    const clientId = await ensureClient();
    const ageMs =
      options.ageMs ?? EARNINGS_HOLD_PERIOD_MS + 24 * 60 * 60 * 1000;

    const [job] = await db
      .insert(job_posts)
      .values({
        client_id: clientId,
        title: "Integration job",
        description: "Integration test job",
        expertise_level: "INTERMEDIATE",
        expected_duration: "1 week",
        total_budget_cents: amountCents,
        milestones: [],
      })
      .returning({ id: job_posts.id });
    created.jobIds.push(job!.id);

    const [proposal] = await db
      .insert(proposals)
      .values({
        job_id: job!.id,
        sender_id: owner.freelancerId ?? `${prefix}${owner.agencyId}`,
        sender_type: owner.freelancerId ? "FREELANCER" : "AGENCY",
        cover_letter: "integration",
        bid_amount_cents: amountCents,
        duration: "1 week",
      })
      .returning({ id: proposals.id });
    created.proposalIds.push(proposal!.id);

    const [contract] = await db
      .insert(contracts)
      .values({
        proposal_id: proposal!.id,
        job_id: job!.id,
        client_id: clientId,
        freelancer_id: owner.freelancerId ?? null,
        agency_id: owner.agencyId ?? null,
        title: "Integration contract",
        total_amount_cents: amountCents,
      })
      .returning({ id: contracts.id });
    created.contractIds.push(contract!.id);

    const [milestone] = await db
      .insert(contract_milestones)
      .values({
        contract_id: contract!.id,
        title: "Integration milestone",
        amount_cents: amountCents,
        due_date: "2026-01-01",
        position: 0,
      })
      .returning({ id: contract_milestones.id });

    const [earning] = await db
      .insert(earning_history)
      .values({
        freelancer_id: owner.freelancerId ?? null,
        agency_id: owner.agencyId ?? null,
        contract_id: contract!.id,
        milestone_id: milestone!.id,
        amount_cents: amountCents,
        platform_fee_cents: options.feeCents ?? 1000,
        description: "Integration earning",
        created_at: new Date(Date.now() - ageMs),
      })
      .returning({ id: earning_history.id });
    created.earningIds.push(earning!.id);
    return earning!.id;
  };

  const createPayout = async (
    earningId: string,
    owner: Owner,
    seed: PayoutSeed = {},
  ) => {
    const status = seed.status ?? "PENDING";
    const [row] = await db
      .insert(payout_history)
      .values({
        freelancer_id: owner.freelancerId ?? null,
        agency_id: owner.agencyId ?? null,
        earning_history_id: earningId,
        amount_cents: seed.amountCents ?? 10000,
        status,
        attempts: seed.attempts ?? 0,
        claimed_at:
          seed.claimedMinutesAgo === undefined
            ? null
            : sql`now() - ${seed.claimedMinutesAgo}::int * interval '1 minute'`,
        next_retry_at:
          seed.nextRetryInSeconds === undefined
            ? null
            : sql`now() + ${seed.nextRetryInSeconds}::int * interval '1 second'`,
        paid_at: status === "PAID" ? sql`now()` : null,
        notified_at: seed.notified ? sql`now()` : null,
        stripe_transfer_id:
          seed.stripeTransferId ??
          (status === "PAID" ? `tr_it_${randomUUID()}` : null),
        idempotency_key: seed.idempotencyKey ?? null,
        last_error: seed.lastError ?? null,
        destination_account_id: seed.destinationAccountId ?? null,
      })
      .returning({ id: payout_history.id });
    return row!.id;
  };

  const createPayoutFixture = async (
    options: {
      owner?: "freelancer" | "agency";
      connectAccount?: boolean;
      payout?: PayoutSeed | null;
      earning?: { amountCents?: number; feeCents?: number; ageMs?: number };
    } = {},
  ) => {
    const isAgency = options.owner === "agency";
    const party = isAgency
      ? await createAgency({ connectAccount: options.connectAccount })
      : await createFreelancer({ connectAccount: options.connectAccount });
    const owner: Owner = isAgency
      ? { agencyId: (party as { agencyId: string }).agencyId }
      : { freelancerId: (party as { authId: string }).authId };
    const earningId = await createEarning(owner, options.earning);
    const payoutId =
      options.payout === null
        ? undefined
        : await createPayout(earningId, owner, options.payout);
    return {
      owner,
      connectAccountId: party.connectAccountId,
      earningId,
      payoutId,
    };
  };

  const cleanup = async () => {
    if (created.earningIds.length > 0) {
      await db
        .delete(payout_history)
        .where(inArray(payout_history.earning_history_id, created.earningIds));
      await db
        .delete(earning_history)
        .where(inArray(earning_history.id, created.earningIds));
    }
    if (created.contractIds.length > 0) {
      await db
        .delete(contracts)
        .where(inArray(contracts.id, created.contractIds));
    }
    if (created.proposalIds.length > 0) {
      await db
        .delete(proposals)
        .where(inArray(proposals.id, created.proposalIds));
    }
    if (created.jobIds.length > 0) {
      await db.delete(job_posts).where(inArray(job_posts.id, created.jobIds));
    }
    if (created.agencyIds.length > 0) {
      await db
        .delete(agency_metadata)
        .where(inArray(agency_metadata.id, created.agencyIds));
    }
    if (created.accountIds.length > 0) {
      await db
        .delete(accounts)
        .where(inArray(accounts.auth_id, created.accountIds));
    }
  };

  return {
    created,
    createFreelancer,
    createAgency,
    createEarning,
    createPayout,
    createPayoutFixture,
    cleanup,
  };
};
