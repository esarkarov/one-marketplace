import { and, eq } from "drizzle-orm";
import type { DbExecutor } from "../../database/db-executor.js";
import { accounts } from "./auth.schema.js";

export const setStripeCustomerId = async (
  executor: DbExecutor,
  accountId: string,
  customerId: string,
) => {
  await executor
    .update(accounts)
    .set({ stripe_customer_id: customerId, updated_at: new Date() })
    .where(eq(accounts.auth_id, accountId));
};

export const markClientOnboardingComplete = async (
  executor: DbExecutor,
  userId: string,
  now: Date,
) => {
  const [account] = await executor
    .update(accounts)
    .set({
      isOnboardingComplete: true,
      updated_at: now,
    })
    .where(and(eq(accounts.auth_id, userId), eq(accounts.role, "CLIENT")))
    .returning({
      id: accounts.id,
      identityVerified: accounts.identityVerified,
      paymentMethodVerified: accounts.paymentMethodVerified,
    });
  return account;
};

export const markFreelancerOnboardingComplete = async (
  executor: DbExecutor,
  userId: string,
) => {
  const [account] = await executor
    .update(accounts)
    .set({ isOnboardingComplete: true })
    .where(and(eq(accounts.auth_id, userId), eq(accounts.role, "FREELANCER")))
    .returning();
  return account;
};

export const markPaymentMethodVerified = async (
  executor: DbExecutor,
  accountId: string,
) => {
  await executor
    .update(accounts)
    .set({ paymentMethodVerified: true, updated_at: new Date() })
    .where(eq(accounts.auth_id, accountId));
};

export const markIdentityVerified = async (
  executor: DbExecutor,
  accountId: string,
  role: "CLIENT" | "FREELANCER",
) => {
  const [account] = await executor
    .update(accounts)
    .set({ identityVerified: true, updated_at: new Date() })
    .where(and(eq(accounts.auth_id, accountId), eq(accounts.role, role)))
    .returning({ id: accounts.id });
  return account !== undefined;
};

export const setStripeConnectAccountId = async (
  executor: DbExecutor,
  accountId: string,
  connectAccountId: string,
) => {
  await executor
    .update(accounts)
    .set({
      stripe_connect_account_id: connectAccountId,
      updated_at: new Date(),
    })
    .where(eq(accounts.auth_id, accountId));
};
