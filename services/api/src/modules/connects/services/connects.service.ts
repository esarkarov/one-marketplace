import { toConnectsHistoryEntryResponse } from "@/modules/connects/utils/connects.mappers.js";
import {
  CONNECTS_CACHE_TTL_SECONDS,
  CONNECTS_PLANS,
  ConnectsPlan,
  INITIAL_CONNECTS,
} from "@/modules/connects/constants/connects.constants.js";
import {
  getAgencyConnectsCacheKey,
  getConnectsCacheKey,
} from "@/modules/connects/utils/connects.cache-keys.js";
import { db } from "@/database/client.js";
import {
  fetchSize,
  toOffsetPage,
} from "@/shared/validation/utils/pagination.utils.js";
import { setStripeCustomerId } from "@/modules/auth/index.js";
import {
  creditConnects,
  findAgencyConnectsBalance,
  findAgencyConnectsHistory,
  findCheckoutAccount,
  findFreelancerProfileAuthId,
  findFreelancerConnectsHistory,
  insertAgencyConnectsIfAbsent,
  insertAgencyPurchaseIfNew,
  insertFreelancerConnectsIfAbsent,
  insertFreelancerPurchaseIfNew,
  recordConnectsHistory,
} from "@/modules/connects/repositories/connects.repository.js";
import { ApiError } from "@/shared/errors/api-error.js";
import { redis } from "@/infrastructure/cache/redis.client.js";
import { env } from "@/config/env.js";
import { stripe } from "@/infrastructure/payments/stripe.client.js";

const cacheBalance = (freelancerId: string, balance: number) =>
  redis.setEx(
    getConnectsCacheKey(freelancerId),
    CONNECTS_CACHE_TTL_SECONDS,
    String(balance),
  );

export const addConnects = async (freelancerId: string) => {
  const balance = await db.transaction(async (transaction) => {
    const balance = await insertFreelancerConnectsIfAbsent(
      transaction,
      freelancerId,
      INITIAL_CONNECTS,
    );

    if (!balance) return;

    await recordConnectsHistory(transaction, {
      connectsId: balance.id,
      type: "Onboarding Bonus",
      description: "New account welcome Connects",
      amount: INITIAL_CONNECTS,
    });

    return balance;
  });

  if (balance) await cacheBalance(freelancerId, balance.connects);
  return balance;
};

export const addAgencyConnects = async (agencyId: string) => {
  const balance = await db.transaction(async (transaction) => {
    const balance = await insertAgencyConnectsIfAbsent(
      transaction,
      agencyId,
      INITIAL_CONNECTS,
    );

    if (!balance) return;

    await recordConnectsHistory(transaction, {
      connectsId: balance.id,
      type: "Onboarding Bonus",
      description: "New agency welcome Connects",
      amount: INITIAL_CONNECTS,
    });

    return balance;
  });

  if (balance) {
    await redis.setEx(
      getAgencyConnectsCacheKey(agencyId),
      CONNECTS_CACHE_TTL_SECONDS,
      String(balance.connects),
    );
  }
  return balance;
};

export const getAgencyConnectsBalance = async (
  agencyId: string,
): Promise<number> => {
  const cacheKey = getAgencyConnectsCacheKey(agencyId);
  const cachedConnects = await redis.get(cacheKey);

  if (cachedConnects !== null) {
    await redis.expire(cacheKey, CONNECTS_CACHE_TTL_SECONDS);
    return Number(cachedConnects);
  }

  const balance = await findAgencyConnectsBalance(db, agencyId);

  const value = balance?.connects ?? 0;
  await redis.setEx(cacheKey, CONNECTS_CACHE_TTL_SECONDS, String(value));
  return value;
};

interface Page {
  limit: number;
  offset: number;
}

export const getAgencyConnectsHistory = async (
  agencyId: string,
  { limit, offset }: Page,
) => {
  const { rows, hasMore } = toOffsetPage(
    await findAgencyConnectsHistory(db, agencyId, {
      limit: fetchSize(limit),
      offset,
    }),
    limit,
  );
  return { results: rows.map(toConnectsHistoryEntryResponse), hasMore };
};

export const getConnectsHistory = async (
  freelancerId: string,
  { limit, offset }: Page,
) => {
  const { rows, hasMore } = toOffsetPage(
    await findFreelancerConnectsHistory(db, freelancerId, {
      limit: fetchSize(limit),
      offset,
    }),
    limit,
  );
  return { results: rows.map(toConnectsHistoryEntryResponse), hasMore };
};

export const createConnectsCheckout = async (
  freelancerId: string,
  purchasedConnects: ConnectsPlan,
) => {
  if (!env.stripeSecretKey || !env.freelancerDashboard) {
    throw new ApiError(503, "Connects payments are not configured.");
  }

  const account = await findCheckoutAccount(db, freelancerId);

  if (!account) throw new ApiError(404, "Freelancer account not found.");

  if (!(await findFreelancerProfileAuthId(db, freelancerId))) {
    throw new ApiError(
      404,
      "Freelancer profile has not been completed.",
      "PROFILE_NOT_FOUND",
    );
  }

  let customerId = account.stripe_customer_id;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: account.email,
      metadata: { freelancerId },
    });
    customerId = customer.id;

    await setStripeCustomerId(db, freelancerId, customerId);
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: CONNECTS_PLANS[purchasedConnects],
          product_data: { name: `${purchasedConnects} Connects` },
        },
      },
    ],
    metadata: {
      freelancerId,
      purchasedConnects: String(purchasedConnects),
    },
    success_url: `${env.freelancerDashboard}/settings?section=connects&payment=success`,
    cancel_url: `${env.freelancerDashboard}/settings?section=connects&payment=cancelled`,
  });
  if (!session.url) throw new ApiError(502, "Stripe Checkout could not start.");
  return session.url;
};

export const completeConnectsPurchase = async (
  freelancerId: string,
  purchasedConnects: ConnectsPlan,
  paymentId: string,
) => {
  const balance = await db.transaction(async (transaction) => {
    await insertFreelancerConnectsIfAbsent(transaction, freelancerId, 0);

    const purchase = await insertFreelancerPurchaseIfNew(transaction, {
      freelancerId,
      purchasedConnects,
      amountPaidCents: CONNECTS_PLANS[purchasedConnects],
      paymentId,
    });

    if (!purchase) return;

    const updatedBalance = await creditConnects(
      transaction,
      { freelancerId },
      purchasedConnects,
    );

    if (!updatedBalance) throw new ApiError(404, "Connects balance not found.");

    await recordConnectsHistory(transaction, {
      connectsId: updatedBalance.id,
      type: "Connects purchased",
      description: `Purchased ${purchasedConnects} Connects`,
      amount: purchasedConnects,
    });

    return updatedBalance;
  });
  if (balance) await cacheBalance(freelancerId, balance.connects);
};

export const createAgencyConnectsCheckout = async (
  ownerId: string,
  agencyId: string,
  purchasedConnects: ConnectsPlan,
) => {
  if (!env.stripeSecretKey || !env.agencyDashboard) {
    throw new ApiError(503, "Connects payments are not configured.");
  }

  const account = await findCheckoutAccount(db, ownerId);

  if (!account) throw new ApiError(404, "Agency owner account not found.");

  let customerId = account.stripe_customer_id;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: account.email,
      metadata: { ownerId, agencyId },
    });
    customerId = customer.id;

    await setStripeCustomerId(db, ownerId, customerId);
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: CONNECTS_PLANS[purchasedConnects],
          product_data: { name: `${purchasedConnects} Agency Connects` },
        },
      },
    ],
    metadata: {
      agencyId,
      purchasedConnects: String(purchasedConnects),
    },
    success_url: `${env.agencyDashboard}/finances?section=connects&payment=success`,
    cancel_url: `${env.agencyDashboard}/finances?section=connects&payment=cancelled`,
  });
  if (!session.url) throw new ApiError(502, "Stripe Checkout could not start.");
  return session.url;
};

export const completeAgencyConnectsPurchase = async (
  agencyId: string,
  purchasedConnects: ConnectsPlan,
  paymentId: string,
) => {
  const balance = await db.transaction(async (transaction) => {
    await insertAgencyConnectsIfAbsent(transaction, agencyId, 0);

    const purchase = await insertAgencyPurchaseIfNew(transaction, {
      agencyId,
      purchasedConnects,
      amountPaidCents: CONNECTS_PLANS[purchasedConnects],
      paymentId,
    });

    if (!purchase) return;

    const updatedBalance = await creditConnects(
      transaction,
      { agencyId },
      purchasedConnects,
    );

    if (!updatedBalance) throw new ApiError(404, "Connects balance not found.");

    await recordConnectsHistory(transaction, {
      connectsId: updatedBalance.id,
      type: "Connects purchased",
      description: `Purchased ${purchasedConnects} Connects`,
      amount: purchasedConnects,
    });

    return updatedBalance;
  });

  if (balance) {
    await redis.setEx(
      getAgencyConnectsCacheKey(agencyId),
      CONNECTS_CACHE_TTL_SECONDS,
      String(balance.connects),
    );
  }
};
