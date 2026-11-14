import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { DbExecutor } from "../../database/db-executor.js";
import { accounts } from "../auth/auth.schema.js";
import { client_metadata } from "../client/client.schema.js";
import { contracts, earning_history } from "../contracts/contracts.schema.js";
import { payout_history } from "../payouts/payouts.schema.js";
import { freelancer_metadata } from "./freelancer.schema.js";

export const findHasEarnings = async (executor: DbExecutor, userId: string) => {
  const [earningsCheck] = await executor
    .select({ hasEarnings: sql<boolean>`count(*) > 0` })
    .from(earning_history)
    .where(eq(earning_history.freelancer_id, userId));
  return earningsCheck;
};

export const listMonthlyEarningTotals = (
  executor: DbExecutor,
  userId: string,
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
        eq(earning_history.freelancer_id, userId),
        gte(earning_history.created_at, spanStart),
      ),
    )
    .groupBy(sql`date_trunc('month', ${earning_history.created_at})`)
    .orderBy(sql`date_trunc('month', ${earning_history.created_at})`);

export const listEarningsWithPayoutState = (
  executor: DbExecutor,
  userId: string,
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
    .where(eq(earning_history.freelancer_id, userId))
    .orderBy(desc(earning_history.created_at));

export const findCertificateAccount = async (
  executor: DbExecutor,
  userId: string,
) => {
  const [account] = await executor
    .select({
      professionalTitle: freelancer_metadata.professional_title,
      country: freelancer_metadata.country,
      city: freelancer_metadata.city,
      activeSince: freelancer_metadata.created_at,
      profileId: freelancer_metadata.id,
    })
    .from(accounts)
    .innerJoin(
      freelancer_metadata,
      eq(freelancer_metadata.auth_id, accounts.auth_id),
    )
    .where(and(eq(accounts.auth_id, userId), eq(accounts.role, "FREELANCER")))
    .limit(1);
  return account;
};

export const listEarningAmounts = (executor: DbExecutor, userId: string) =>
  executor
    .select({
      amountCents: earning_history.amount_cents,
      platformFeeCents: earning_history.platform_fee_cents,
      createdAt: earning_history.created_at,
    })
    .from(earning_history)
    .where(eq(earning_history.freelancer_id, userId));

export const findPayoutAccount = async (
  executor: DbExecutor,
  userId: string,
) => {
  const [account] = await executor
    .select({
      email: accounts.email,
      stripeConnectAccountId: accounts.stripe_connect_account_id,
      country: freelancer_metadata.country,
    })
    .from(accounts)
    .leftJoin(
      freelancer_metadata,
      eq(freelancer_metadata.auth_id, accounts.auth_id),
    )
    .where(and(eq(accounts.auth_id, userId), eq(accounts.role, "FREELANCER")))
    .limit(1);
  return account;
};
