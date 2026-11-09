import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  CONNECTS_CACHE_TTL_SECONDS,
  CONNECTS_PLANS,
  ConnectsPlan,
  getAgencyConnectsCacheKey,
  getConnectsCacheKey,
  INITIAL_CONNECTS,
  PROPOSAL_CONNECTS,
} from "../../config/constants.js";
import { db } from "../../database/client.js";
import {
  accounts,
  connects,
  connects_history,
  connects_purchase_history,
} from "../../database/schema.js";
import { ApiError } from "../../utils/api-error.js";
import { redis } from "../../config/redis.js";
import { env } from "../../config/env.js";
import { stripe } from "../../config/stripe.js";

const cacheBalance = (freelancerId: string, balance: number) =>
  redis.setEx(
    getConnectsCacheKey(freelancerId),
    CONNECTS_CACHE_TTL_SECONDS,
    String(balance),
  );

export const addConnects = async (freelancerId: string) => {
  const balance = await db.transaction(async (transaction) => {
    const [balance] = await transaction
      .insert(connects)
      .values({
        freelancer_id: freelancerId,
        connects: INITIAL_CONNECTS,
      })
      .onConflictDoNothing({ target: connects.freelancer_id })
      .returning();

    if (!balance) return;

    await transaction.insert(connects_history).values({
      connects_id: balance.id,
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
    const [balance] = await transaction
      .insert(connects)
      .values({
        agency_id: agencyId,
        connects: INITIAL_CONNECTS,
      })
      .onConflictDoNothing({ target: connects.agency_id })
      .returning();

    if (!balance) return;

    await transaction.insert(connects_history).values({
      connects_id: balance.id,
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

  const [balance] = await db
    .select({ connects: connects.connects })
    .from(connects)
    .where(eq(connects.agency_id, agencyId))
    .limit(1);

  const value = balance?.connects ?? 0;
  await redis.setEx(cacheKey, CONNECTS_CACHE_TTL_SECONDS, String(value));
  return value;
};

export const getAgencyConnectsHistory = async (agencyId: string) =>
  await db
    .select({
      id: connects_history.id,
      type: connects_history.type,
      description: connects_history.description,
      amount: connects_history.amount,
      created_at: connects_history.created_at,
    })
    .from(connects_history)
    .innerJoin(connects, eq(connects_history.connects_id, connects.id))
    .where(eq(connects.agency_id, agencyId))
    .orderBy(desc(connects_history.created_at))
    .limit(10);

export const chargeConnects = async (
  freelancerId: string,
  description: string,
) => {
  const balance = await db.transaction(async (transcation) => {
    const [balance] = await transcation
      .update(connects)
      .set({
        connects: sql`${connects.connects} - ${PROPOSAL_CONNECTS}`,
        updated_at: new Date(),
      })
      .where(
        and(
          eq(connects.freelancer_id, freelancerId),
          gte(connects.connects, PROPOSAL_CONNECTS),
        ),
      )
      .returning();

    if (!balance) throw new ApiError(400, "Not enough Connects.");

    await transcation.insert(connects_history).values({
      connects_id: balance.id,
      type: "Proposal submitted",
      description,
      amount: -PROPOSAL_CONNECTS,
    });
    return balance;
  });

  await cacheBalance(freelancerId, balance.connects);
  return balance;
};

export const returnConnects = async (
  freelancerId: string,
  description: string,
) => {
  const balance = await db.transaction(async (transaction) => {
    const [balance] = await transaction
      .update(connects)
      .set({
        connects: sql`${connects.connects} + ${PROPOSAL_CONNECTS}`,
        updated_at: new Date(),
      })
      .where(eq(connects.freelancer_id, freelancerId))
      .returning();

    if (!balance) throw new ApiError(404, "Connects balance not found.");

    await transaction.insert(connects_history).values({
      connects_id: balance.id,
      type: "Proposal withdrawn refund",
      description,
      amount: PROPOSAL_CONNECTS,
    });

    return balance;
  });

  await cacheBalance(freelancerId, balance.connects);
  return balance;
};

export const getConnectsHistory = async (freelancerId: string) =>
  await db
    .select({
      id: connects_history.id,
      type: connects_history.type,
      description: connects_history.description,
      amount: connects_history.amount,
      created_at: connects_history.created_at,
    })
    .from(connects_history)
    .innerJoin(connects, eq(connects_history.connects_id, connects.id))
    .where(eq(connects.freelancer_id, freelancerId))
    .orderBy(desc(connects_history.created_at))
    .limit(10);

export const createConnectsCheckout = async (
  freelancerId: string,
  purchasedConnects: ConnectsPlan,
) => {
  if (!env.stripeSecretKey || !env.freelancerDashboard) {
    throw new ApiError(503, "Connects payments are not configured.");
  }

  const [account] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.auth_id, freelancerId))
    .limit(1);

  if (!account) throw new ApiError(404, "Freelancer account not found.");

  let customerId = account.stripe_customer_id;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: account.email,
      metadata: { freelancerId },
    });
    customerId = customer.id;

    await db
      .update(accounts)
      .set({ stripe_customer_id: customerId, updated_at: new Date() })
      .where(eq(accounts.auth_id, freelancerId));
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
    success_url: `${env.freelancerDashboard}/settings?section=connects&payment=succes`,
    cancel_url: `${env.freelancerDashboard}/settings?section=connects`,
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
    const [purchase] = await transaction
      .insert(connects_purchase_history)
      .values({
        connects_id: sql`(select ${connects.id} from ${connects} where ${connects.freelancer_id} = ${freelancerId})`,
        purchased_connects: purchasedConnects,
        amount_paid: String(CONNECTS_PLANS[purchasedConnects] / 100),
        payment_id: paymentId,
        status: "COMPLETED",
      })
      .onConflictDoNothing({ target: connects_purchase_history.payment_id })
      .returning();

    if (!purchase) return;

    const [updatedBalance] = await transaction
      .update(connects)
      .set({
        connects: sql`${connects.connects} + ${purchasedConnects}`,
        updated_at: new Date(),
      })
      .where(eq(connects.freelancer_id, freelancerId))
      .returning();

    if (!updatedBalance) throw new ApiError(404, "Connects balance not found.");

    await transaction.insert(connects_history).values({
      connects_id: updatedBalance.id,
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

  const [account] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.auth_id, ownerId))
    .limit(1);

  if (!account) throw new ApiError(404, "Agency owner account not found.");

  let customerId = account.stripe_customer_id;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: account.email,
      metadata: { ownerId, agencyId },
    });
    customerId = customer.id;

    await db
      .update(accounts)
      .set({ stripe_customer_id: customerId, updated_at: new Date() })
      .where(eq(accounts.auth_id, ownerId));
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
    cancel_url: `${env.agencyDashboard}/finances?section=connects`,
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
    const [purchase] = await transaction
      .insert(connects_purchase_history)
      .values({
        connects_id: sql`(select ${connects.id} from ${connects} where ${connects.agency_id} = ${agencyId})`,
        purchased_connects: purchasedConnects,
        amount_paid: String(CONNECTS_PLANS[purchasedConnects] / 100),
        payment_id: paymentId,
        status: "COMPLETED",
      })
      .onConflictDoNothing({ target: connects_purchase_history.payment_id })
      .returning();

    if (!purchase) return;

    const [updatedBalance] = await transaction
      .update(connects)
      .set({
        connects: sql`${connects.connects} + ${purchasedConnects}`,
        updated_at: new Date(),
      })
      .where(eq(connects.agency_id, agencyId))
      .returning();

    if (!updatedBalance) throw new ApiError(404, "Connects balance not found.");

    await transaction.insert(connects_history).values({
      connects_id: updatedBalance.id,
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
