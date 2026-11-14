import { db } from "../../database/client.js";
import { toSafeCents } from "../../shared/money/money.js";
import { ApiError } from "../../shared/http/api-error.js";
import { env } from "../../config/env.js";
import { stripe } from "../../infrastructure/stripe.js";
import {
  EARNINGS_HOLD_PERIOD_MS,
  STRIPE_PAYOUT_ELIGIBLE_COUNTRIES,
} from "../../config/constants.js";
import {
  findAgencyPayoutAccount,
  findHasAgencyEarnings,
  listAgencyEarningsWithPayoutState,
  listMonthlyAgencyEarningTotals,
  setAgencyStripeConnectAccountId,
} from "./agency.earnings.repository.js";

const MONTHLY_EARNINGS_SPAN = 7;

export const getAgencyMonthlyEarnings = async (agencyId: string) => {
  const earningsCheck = await findHasAgencyEarnings(db, agencyId);
  const hasEarnings = earningsCheck?.hasEarnings ?? false;

  if (!hasEarnings) {
    return {
      hasEarnings: false,
      currentMonthTotalCents: 0,
      previousMonthTotalCents: 0,
      series: [] as Array<{ month: string; totalCents: number }>,
    };
  }

  const spanStart = new Date();
  spanStart.setUTCDate(1);
  spanStart.setUTCHours(0, 0, 0, 0);
  spanStart.setUTCMonth(spanStart.getUTCMonth() - (MONTHLY_EARNINGS_SPAN - 1));

  const rows = await listMonthlyAgencyEarningTotals(db, agencyId, spanStart);

  const totalsByMonth = new Map(
    rows.map((row) => [row.month, toSafeCents(row.totalCents)]),
  );

  const series = Array.from({ length: MONTHLY_EARNINGS_SPAN }, (_, index) => {
    const date = new Date(spanStart);
    date.setUTCMonth(date.getUTCMonth() + index);
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    return { month: key, totalCents: totalsByMonth.get(key) ?? 0 };
  });

  return {
    hasEarnings: true,
    currentMonthTotalCents: series.at(-1)?.totalCents ?? 0,
    previousMonthTotalCents: series.at(-2)?.totalCents ?? 0,
    series,
  };
};

const RECENT_AGENCY_EARNINGS_LIMIT = 20;

export const getAgencyEarningsOverview = async (agencyId: string) => {
  const rows = await listAgencyEarningsWithPayoutState(db, agencyId);

  const now = Date.now();
  let availableCents = 0;
  let pendingCents = 0;
  let withdrawnCents = 0;
  let totalFeesCents = 0;

  const earnings = rows.map((row) => {
    const grossAmountCents = row.amountCents;
    const platformFeeCents = row.platformFeeCents;
    const amountCents = grossAmountCents - platformFeeCents;
    const availableAt = new Date(
      row.createdAt.getTime() + EARNINGS_HOLD_PERIOD_MS,
    );
    const isAvailable = now >= availableAt.getTime();
    totalFeesCents += platformFeeCents;

    // A row already transferred to Stripe (payout_history) is neither
    // available nor pending anymore — the money has already left the
    // platform, so it must not be double-counted as still withdrawable.
    let status: "AVAILABLE" | "PENDING" | "WITHDRAWN";
    if (row.paidOut) {
      withdrawnCents += amountCents;
      status = "WITHDRAWN";
    } else if (isAvailable) {
      availableCents += amountCents;
      status = "AVAILABLE";
    } else {
      pendingCents += amountCents;
      status = "PENDING";
    }

    return {
      id: row.id,
      title: row.contractTitle,
      client: row.clientCompany ?? "Client",
      grossAmountCents,
      platformFeeCents,
      amountCents,
      date: row.createdAt,
      availableAt,
      status,
    };
  });

  return {
    availableCents,
    pendingCents,
    withdrawnCents,
    lifetimeCents: availableCents + pendingCents + withdrawnCents,
    totalFeesCents,
    recentEarnings: earnings.slice(0, RECENT_AGENCY_EARNINGS_LIMIT),
  };
};

type StripeRequirementsLike =
  | {
      entries?: Array<{
        awaiting_action_from: string;
        minimum_deadline: { status: string };
      }>;
    }
  | undefined;

const hasBlockingAgencyRequirements = (requirements: StripeRequirementsLike) =>
  (requirements?.entries ?? []).some(
    (entry) =>
      entry.awaiting_action_from === "user" &&
      entry.minimum_deadline.status !== "eventually_due",
  );

export const getAgencyPayoutManagementUrl = async (agencyId: string) => {
  if (!env.stripeSecretKey || !env.agencyDashboard) {
    throw new ApiError(503, "Payouts are not configured.");
  }

  const agency = await findAgencyPayoutAccount(db, agencyId);

  if (!agency) throw new ApiError(404, "Agency workspace not found.");

  let connectAccountId = agency.stripeConnectAccountId;
  let hasPendingRequirements: boolean;

  if (!connectAccountId) {
    // The agency has no country of its own on file — bootstrap the Connect
    // account with the owner's real country as the best available signal,
    // same fallback-to-"us" rule as freelancer accounts. The payout
    // destination is still the agency's own account, not the owner's.
    const realCountry = agency.ownerCountry?.toUpperCase();
    const connectCountry =
      realCountry && STRIPE_PAYOUT_ELIGIBLE_COUNTRIES.has(realCountry)
        ? realCountry.toLowerCase()
        : "us";

    const connectAccount = await stripe.v2.core.accounts.create({
      contact_email: agency.ownerEmail,
      dashboard: "express",
      identity: { country: connectCountry },
      configuration: {
        recipient: {
          capabilities: {
            stripe_balance: {
              stripe_transfers: { requested: true },
            },
          },
        },
        merchant: {
          capabilities: {
            card_payments: { requested: true },
          },
        },
      },
      defaults: {
        responsibilities: {
          fees_collector: "application_express",
          losses_collector: "application",
        },
      },
      include: ["requirements"],
    });

    connectAccountId = connectAccount.id;
    hasPendingRequirements = hasBlockingAgencyRequirements(
      connectAccount.requirements,
    );

    await setAgencyStripeConnectAccountId(db, agencyId, connectAccountId);
  } else {
    const existingAccount = await stripe.v2.core.accounts.retrieve(
      connectAccountId,
      { include: ["requirements"] },
    );
    hasPendingRequirements = hasBlockingAgencyRequirements(
      existingAccount.requirements,
    );
  }

  const returnUrl = `${env.agencyDashboard}/finances?section=withdrawals`;

  if (hasPendingRequirements) {
    const accountLink = await stripe.v2.core.accountLinks.create({
      account: connectAccountId,
      use_case: {
        type: "account_onboarding",
        account_onboarding: {
          refresh_url: returnUrl,
          return_url: returnUrl,
        },
      },
    });
    return accountLink.url;
  }

  const loginLink = await stripe.accounts.createLoginLink(connectAccountId);
  return loginLink.url;
};
