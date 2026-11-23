import { env } from "@/config/env.js";
import { logger } from "@/config/logger.js";
import { db } from "@/database/client.js";
import { clerk } from "@/infrastructure/auth/clerk.client.js";
import { CLERK_DISPLAY_SYNC_TIMEOUT_MS } from "@/modules/auth/constants/auth.constants.js";
import {
  findAccountDisplay,
  listAccountDisplays,
  listAccountEmails,
  updateAccountDisplay,
} from "@/modules/auth/repositories/auth.repository.js";
import type { AccountDisplay } from "@/modules/auth/types/auth.types.js";

interface ClerkDisplaySource {
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  imageUrl: string | null;
}

export const toAccountDisplay = (user: ClerkDisplaySource): AccountDisplay => ({
  displayName:
    [user.firstName, user.lastName]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(" ") ||
    user.fullName?.trim() ||
    null,
  avatarUrl: user.imageUrl || null,
});

const EMPTY_DISPLAY: AccountDisplay = { displayName: null, avatarUrl: null };

export const findAccountDisplays = async (
  authIds: string[],
): Promise<Map<string, AccountDisplay>> => {
  const unique = [...new Set(authIds)];
  if (unique.length === 0) return new Map();

  const rows = await listAccountDisplays(db, unique);
  return new Map(
    rows.map(({ authId, displayName, avatarUrl }) => [
      authId,
      { displayName, avatarUrl },
    ]),
  );
};

export const findAccountEmails = async (
  authIds: string[],
): Promise<Map<string, string | null>> => {
  const unique = [...new Set(authIds)];
  if (unique.length === 0) return new Map();

  const rows = await listAccountEmails(db, unique);
  return new Map(rows.map(({ authId, email }) => [authId, email || null]));
};

const fetchWithTimeout = async (authId: string) => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("Clerk display sync timed out")),
      CLERK_DISPLAY_SYNC_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([clerk.users.getUser(authId), timeout]);
  } finally {
    clearTimeout(timer);
  }
};

const logFailure = (reason: string, error?: unknown) =>
  logger.warn({
    message: "Account display data could not be refreshed",
    eventName: "account.display_sync.failed",
    attributes: {
      reason,
      "error.name": error instanceof Error ? error.name : "UnknownError",
    },
  });

export const syncAccountDisplay = async (
  authId: string,
): Promise<AccountDisplay> => {
  let stored: AccountDisplay = EMPTY_DISPLAY;
  try {
    stored = (await findAccountDisplay(db, authId)) ?? EMPTY_DISPLAY;

    if (!env.clerkSecretKey) {
      await logFailure("clerk_not_configured");
      return stored;
    }

    const next = toAccountDisplay(await fetchWithTimeout(authId));
    if (
      next.displayName === stored.displayName &&
      next.avatarUrl === stored.avatarUrl
    ) {
      return stored;
    }

    await updateAccountDisplay(db, authId, next);
    return next;
  } catch (error) {
    try {
      await logFailure("sync_failed", error);
    } catch {
      // logging must never break the caller
    }
    return stored;
  }
};
