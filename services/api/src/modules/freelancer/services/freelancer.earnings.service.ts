import { db } from "../../../database/client.js";
import { toSafeCents } from "../../../shared/money/money.js";
import { setStripeConnectAccountId } from "../../auth/index.js";
import {
  findCertificateAccount,
  findHasEarnings,
  findPayoutAccount,
  listEarningAmounts,
  listEarningsWithPayoutState,
  listMonthlyEarningTotals,
} from "../repositories/freelancer.earnings.repository.js";
import { EarningsCertificateData } from "../types/freelancer.types.js";
import { env } from "../../../config/env.js";
import { stripe } from "../../../infrastructure/payments/stripe.js";
import type { StripeRequirementsLike } from "../../../types/common.types.js";
import { ApiError } from "../../../shared/http/api-error.js";
import {
  EARNINGS_HOLD_PERIOD_MS,
  PLATFORM_FEE_BPS,
  STRIPE_PAYOUT_ELIGIBLE_COUNTRIES,
} from "../../../config/constants.js";
import { clerk } from "../../../infrastructure/auth/clerk.js";

const MONTHLY_EARNINGS_SPAN = 7;

export const getFreelancerMonthlyEarnings = async (userId: string) => {
  const earningsCheck = await findHasEarnings(db, userId);
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

  const rows = await listMonthlyEarningTotals(db, userId, spanStart);

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

const RECENT_EARNINGS_LIMIT = 20;

export const getFreelancerEarningsOverview = async (userId: string) => {
  const rows = await listEarningsWithPayoutState(db, userId);

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
    feeRatePercent: PLATFORM_FEE_BPS / 100,
    recentEarnings: earnings.slice(0, RECENT_EARNINGS_LIMIT),
  };
};

const ROLLING_WINDOW_DAYS = [30, 90, 180, 365] as const;

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

export const getFreelancerEarningsCertificateData = async (
  userId: string,
): Promise<EarningsCertificateData> => {
  if (!env.clerkSecretKey) {
    throw new ApiError(503, "Earnings certificates are not configured.");
  }

  const account = await findCertificateAccount(db, userId);

  if (!account) throw new ApiError(404, "Freelancer profile not found.");

  const user = await clerk.users.getUser(userId);
  const freelancerName = user.fullName ?? "Freelancer";

  const rows = await listEarningAmounts(db, userId);

  const now = new Date();

  const windows = ROLLING_WINDOW_DAYS.map((days) => {
    const sinceDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const totalCents = rows.reduce((sum, row) => {
      if (row.createdAt < sinceDate) return sum;
      return sum + (row.amountCents - row.platformFeeCents);
    }, 0);
    return {
      label: `Last ${days} days`,
      totalCents,
    };
  });

  const countryName = account.country
    ? (regionNames.of(account.country) ?? account.country)
    : null;

  return {
    freelancerName,
    professionalTitle: account.professionalTitle,
    profileUrl: `https://www.onemarketplace.io/talent/${account.profileId}`,
    location:
      [account.city, countryName].filter(Boolean).join(", ") || "Not specified",
    activeSince: account.activeSince ?? now,
    issuedAt: now,
    windows,
  };
};

const hasBlockingRequirements = (requirements: StripeRequirementsLike) =>
  (requirements?.entries ?? []).some(
    (entry) =>
      entry.awaiting_action_from === "user" &&
      entry.minimum_deadline.status !== "eventually_due",
  );

export const getFreelancerPayoutManagementUrl = async (userId: string) => {
  if (!env.stripeSecretKey || !env.freelancerDashboard) {
    throw new ApiError(503, "Payouts are not configured.");
  }

  const account = await findPayoutAccount(db, userId);

  if (!account) throw new ApiError(404, "Freelancer account not found.");

  let connectAccountId = account.stripeConnectAccountId;
  let hasPendingRequirements: boolean;

  if (!connectAccountId) {
    // Use the freelancer's real country when Stripe Connect's cross-border
    // transfers support it; otherwise fall back to "us" so the account can
    // still be created and paid (e.g. via a US bank account the freelancer
    // adds themselves) instead of being permanently blocked. The account's
    // country can never be changed after creation.
    const realCountry = account.country?.toUpperCase();
    const connectCountry =
      realCountry && STRIPE_PAYOUT_ELIGIBLE_COUNTRIES.has(realCountry)
        ? realCountry.toLowerCase()
        : "us";

    const connectAccount = await stripe.v2.core.accounts.create({
      contact_email: account.email,
      dashboard: "express",
      identity: { country: connectCountry },
      configuration: {
        // Stripe requires merchant.card_payments to be requested alongside
        // recipient.stripe_balance.stripe_transfers — even though this
        // platform never routes card payments through the freelancer's own
        // merchant capability (clients pay via the platform's own Checkout;
        // funds move to freelancers only via internal transfers).
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
    hasPendingRequirements = hasBlockingRequirements(
      connectAccount.requirements,
    );

    await setStripeConnectAccountId(db, userId, connectAccountId);
  } else {
    const existingAccount = await stripe.v2.core.accounts.retrieve(
      connectAccountId,
      { include: ["requirements"] },
    );
    hasPendingRequirements = hasBlockingRequirements(
      existingAccount.requirements,
    );
  }

  const returnUrl = `${env.freelancerDashboard}/settings?section=withdrawal`;

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
