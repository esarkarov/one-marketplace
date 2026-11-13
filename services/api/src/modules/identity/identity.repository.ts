import { eq } from "drizzle-orm";
import type { DbExecutor } from "../../database/db-executor.js";
import { accounts } from "../auth/auth.schema.js";

export const findAccountIdentityStatus = async (
  executor: DbExecutor,
  accountId: string,
) => {
  const [account] = await executor
    .select({ identityVerified: accounts.identityVerified })
    .from(accounts)
    .where(eq(accounts.auth_id, accountId))
    .limit(1);
  return account;
};
