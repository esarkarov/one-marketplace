import { clerk } from "../../config/clerk.js";
import { ApiError } from "../../utils/api-error.js";
import { db } from "../../database/client.js";
import { accounts } from "../../database/schema.js";
import { invalidateAccountAuthCache } from "../../utils/account-auth-cache.js";

export interface SignupInput {
  userId: string;
  sessionId?: string;
  role: "client" | "freelancer";
  accountExists: boolean;
  isOnboarded: boolean;
}

const toDatabaseRole = (role: SignupInput["role"]): "CLIENT" | "FREELANCER" =>
  role === "client" ? "CLIENT" : "FREELANCER";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getClerkUserWithRetry = async (userId: string) => {
  const delaysMs = [300, 600];
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await clerk.users.getUser(userId);
    } catch (error) {
      if (attempt >= delaysMs.length) throw error;
      await sleep(delaysMs[attempt]!);
    }
  }
};

export const receiveSignup = async (input: SignupInput): Promise<void> => {
  if (input.accountExists) {
    return;
  }

  const user = await getClerkUserWithRetry(input.userId);
  const email =
    user.primaryEmailAddress?.emailAddress ??
    user.emailAddresses.at(0)?.emailAddress;

  if (!email) {
    throw new ApiError(400, "The authenticated account has no email address.");
  }

  const now = new Date();

  await db
    .insert(accounts)
    .values({
      auth_id: input.userId,
      email,
      role: toDatabaseRole(input.role),
      identityVerified: false,
      isOnboardingComplete: false,
      created_at: now,
      updated_at: now,
    })
    .onConflictDoNothing({
      target: accounts.auth_id,
    });

  await invalidateAccountAuthCache(input.userId);
};
