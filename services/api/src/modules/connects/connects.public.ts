import { and, eq, gte, sql } from "drizzle-orm";
import type { DbExecutor } from "../../database/db-executor.js";
import { connects, connects_history } from "./connects.schema.js";

export {
  addAgencyConnects,
  addConnects,
  createAgencyConnectsCheckout,
  getAgencyConnectsBalance,
  getAgencyConnectsHistory,
} from "./connects.service.js";

type ConnectsOwner = { freelancerId: string } | { agencyId: string };

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
