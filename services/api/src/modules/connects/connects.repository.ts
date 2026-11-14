import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { DbExecutor } from "../../database/db-executor.js";
import { accounts } from "../auth/auth.schema.js";
import {
  connects,
  connects_history,
  connects_purchase_history,
} from "./connects.schema.js";

export type ConnectsOwner = { freelancerId: string } | { agencyId: string };

const ownerFilter = (owner: ConnectsOwner) =>
  "agencyId" in owner
    ? eq(connects.agency_id, owner.agencyId)
    : eq(connects.freelancer_id, owner.freelancerId);

export const debitConnects = async (
  executor: DbExecutor,
  owner: ConnectsOwner,
  amount: number,
) => {
  const [balance] = await executor
    .update(connects)
    .set({
      connects: sql`${connects.connects} - ${amount}`,
      updated_at: new Date(),
    })
    .where(and(ownerFilter(owner), gte(connects.connects, amount)))
    .returning();
  return balance ?? null;
};

export const creditConnects = async (
  executor: DbExecutor,
  owner: ConnectsOwner,
  amount: number,
) => {
  const [balance] = await executor
    .update(connects)
    .set({
      connects: sql`${connects.connects} + ${amount}`,
      updated_at: new Date(),
    })
    .where(ownerFilter(owner))
    .returning();
  return balance ?? null;
};

export const recordConnectsHistory = async (
  executor: DbExecutor,
  entry: {
    connectsId: string;
    type: string;
    description: string;
    amount: number;
  },
) => {
  await executor.insert(connects_history).values({
    connects_id: entry.connectsId,
    type: entry.type,
    description: entry.description,
    amount: entry.amount,
  });
};

export const findFreelancerConnectsBalance = async (
  executor: DbExecutor,
  freelancerId: string,
) => {
  const [balance] = await executor
    .select({ connects: connects.connects })
    .from(connects)
    .where(eq(connects.freelancer_id, freelancerId))
    .limit(1);
  return balance;
};

export const findAgencyConnectsBalance = async (
  executor: DbExecutor,
  agencyId: string,
) => {
  const [balance] = await executor
    .select({ connects: connects.connects })
    .from(connects)
    .where(eq(connects.agency_id, agencyId))
    .limit(1);
  return balance;
};

export const insertFreelancerConnectsIfAbsent = async (
  executor: DbExecutor,
  freelancerId: string,
  initialConnects: number,
) => {
  const [balance] = await executor
    .insert(connects)
    .values({
      freelancer_id: freelancerId,
      connects: initialConnects,
    })
    .onConflictDoNothing({ target: connects.freelancer_id })
    .returning();
  return balance;
};

export const insertAgencyConnectsIfAbsent = async (
  executor: DbExecutor,
  agencyId: string,
  initialConnects: number,
) => {
  const [balance] = await executor
    .insert(connects)
    .values({
      agency_id: agencyId,
      connects: initialConnects,
    })
    .onConflictDoNothing({ target: connects.agency_id })
    .returning();
  return balance;
};

export const findAgencyConnectsHistory = (
  executor: DbExecutor,
  agencyId: string,
) =>
  executor
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

export const findFreelancerConnectsHistory = (
  executor: DbExecutor,
  freelancerId: string,
) =>
  executor
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

export const findCheckoutAccount = async (
  executor: DbExecutor,
  authId: string,
) => {
  const [account] = await executor
    .select()
    .from(accounts)
    .where(eq(accounts.auth_id, authId))
    .limit(1);
  return account;
};

export const insertFreelancerPurchaseIfNew = async (
  executor: DbExecutor,
  input: {
    freelancerId: string;
    purchasedConnects: number;
    amountPaidCents: number;
    paymentId: string;
  },
) => {
  const [purchase] = await executor
    .insert(connects_purchase_history)
    .values({
      connects_id: sql`(select ${connects.id} from ${connects} where ${connects.freelancer_id} = ${input.freelancerId})`,
      purchased_connects: input.purchasedConnects,
      amount_paid_cents: input.amountPaidCents,
      payment_id: input.paymentId,
      status: "COMPLETED",
    })
    .onConflictDoNothing({ target: connects_purchase_history.payment_id })
    .returning();
  return purchase;
};

export const insertAgencyPurchaseIfNew = async (
  executor: DbExecutor,
  input: {
    agencyId: string;
    purchasedConnects: number;
    amountPaidCents: number;
    paymentId: string;
  },
) => {
  const [purchase] = await executor
    .insert(connects_purchase_history)
    .values({
      connects_id: sql`(select ${connects.id} from ${connects} where ${connects.agency_id} = ${input.agencyId})`,
      purchased_connects: input.purchasedConnects,
      amount_paid_cents: input.amountPaidCents,
      payment_id: input.paymentId,
      status: "COMPLETED",
    })
    .onConflictDoNothing({ target: connects_purchase_history.payment_id })
    .returning();
  return purchase;
};
