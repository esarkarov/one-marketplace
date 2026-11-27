import { clerk } from "@/infrastructure/auth/clerk.client.js";
import { callExternal } from "@/infrastructure/utils/external-call.utils.js";
import { ApiError } from "@/shared/errors/api-error.js";
import { db } from "@/database/client.js";
import {
  findAccountIdByAuthId,
  insertAccountIfAbsent,
} from "@/modules/auth/repositories/auth.repository.js";
import { toAccountDisplay } from "./auth.display.service.js";
import { invalidateAccountAuthCache } from "@/infrastructure/cache/account-auth.cache.js";

interface SignupInput {
  userId: string;
  sessionId?: string;
  role: "client" | "freelancer";
  accountExists: boolean;
  isOnboarded: boolean;
}

const toDatabaseRole = (role: SignupInput["role"]): "CLIENT" | "FREELANCER" =>
  role === "client" ? "CLIENT" : "FREELANCER";

const getClerkUserWithRetry = (userId: string) =>
  callExternal("clerk.signup.getUser", () => clerk.users.getUser(userId));

export const receiveSignup = async (
  input: SignupInput,
): Promise<string | null> => {
  if (input.accountExists) {
    return null;
  }

  const user = await getClerkUserWithRetry(input.userId);
  const email =
    user.primaryEmailAddress?.emailAddress ??
    user.emailAddresses.at(0)?.emailAddress;

  if (!email) {
    throw new ApiError(400, "The authenticated account has no email address.");
  }

  const now = new Date();
  const display = toAccountDisplay(user);

  await insertAccountIfAbsent(db, {
    userId: input.userId,
    email,
    role: toDatabaseRole(input.role),
    displayName: display.displayName,
    avatarUrl: display.avatarUrl,
    now,
  });

  await invalidateAccountAuthCache(input.userId);
  return findAccountIdByAuthId(db, input.userId);
};
