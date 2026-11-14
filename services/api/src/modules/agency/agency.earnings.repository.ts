import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { DbExecutor } from "../../database/db-executor.js";
import { accounts } from "../auth/auth.schema.js";
import { client_metadata } from "../client/client.schema.js";
import { contracts, earning_history } from "../contracts/contracts.schema.js";
import { freelancer_metadata } from "../freelancer/freelancer.schema.js";
import { payout_history } from "../payouts/payouts.schema.js";
import { agency_metadata } from "./agency.schema.js";

export const findHasAgencyEarnings = async (
  executor: DbExecutor,
  agencyId: string,
) => {
  const [earningsCheck] = await executor
    .select({ hasEarnings: sql<boolean>`count(*) > 0` })
    .from(earning_history)
    .where(eq(earning_history.agency_id, agencyId));
  return earningsCheck;
};

export const listMonthlyAgencyEarningTotals = (
  executor: DbExecutor,
  agencyId: string,
  spanStart: Date,
) =>
  executor
    .select({
      month: sql<string>`to_char(date_trunc('month', ${earning_history.created_at}), 'YYYY-MM')`,
      totalCents: sql<string>`sum(${earning_history.amount_cents} - ${earning_history.platform_fee_cents})`,
    })
    .from(earning_history)
    .where(
      and(
        eq(earning_history.agency_id, agencyId),
        gte(earning_history.created_at, spanStart),
      ),
    )
    .groupBy(sql`date_trunc('month', ${earning_history.created_at})`)
    .orderBy(sql`date_trunc('month', ${earning_history.created_at})`);

export const listAgencyEarningsWithPayoutState = (
  executor: DbExecutor,
  agencyId: string,
) =>
  executor
    .select({
      id: earning_history.id,
      amountCents: earning_history.amount_cents,
      platformFeeCents: earning_history.platform_fee_cents,
      createdAt: earning_history.created_at,
      contractTitle: contracts.title,
      clientCompany: client_metadata.company_name,
      paidOut: sql<boolean>`${payout_history.id} is not null`,
    })
    .from(earning_history)
    .innerJoin(contracts, eq(earning_history.contract_id, contracts.id))
    .leftJoin(client_metadata, eq(contracts.client_id, client_metadata.auth_id))
    .leftJoin(
      payout_history,
      and(
        eq(payout_history.earning_history_id, earning_history.id),
        eq(payout_history.status, "PAID"),
      ),
    )
    .where(eq(earning_history.agency_id, agencyId))
    .orderBy(desc(earning_history.created_at));

export const findAgencyPayoutAccount = async (
  executor: DbExecutor,
  agencyId: string,
) => {
  const [agency] = await executor
    .select({
      name: agency_metadata.name,
      ownerId: agency_metadata.owner_id,
      stripeConnectAccountId: agency_metadata.stripe_connect_account_id,
      ownerEmail: accounts.email,
      ownerCountry: freelancer_metadata.country,
    })
    .from(agency_metadata)
    .innerJoin(accounts, eq(accounts.auth_id, agency_metadata.owner_id))
    .leftJoin(
      freelancer_metadata,
      eq(freelancer_metadata.auth_id, agency_metadata.owner_id),
    )
    .where(eq(agency_metadata.id, agencyId))
    .limit(1);
  return agency;
};

export const setAgencyStripeConnectAccountId = async (
  executor: DbExecutor,
  agencyId: string,
  connectAccountId: string,
) => {
  await executor
    .update(agency_metadata)
    .set({
      stripe_connect_account_id: connectAccountId,
      updated_at: new Date(),
    })
    .where(eq(agency_metadata.id, agencyId));
};
