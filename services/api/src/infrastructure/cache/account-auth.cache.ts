import { getAccountAuthCacheKeys } from "../utils/account-auth-cache-key.utils.js";
import { logger } from "../../config/logger.js";
import { redis } from "./redis.client.js";
import { errorLogAttributes } from "../../shared/logging/sanitize-log.js";

export const invalidateAccountAuthCache = async (
  userId: string,
): Promise<void> => {
  try {
    await redis.del(getAccountAuthCacheKeys(userId));
  } catch (error) {
    await logger.warn({
      message: "Account auth cache could not be invalidated",
      eventName: "auth.cache.invalidate_failed",
      attributes: {
        ...errorLogAttributes(error),
      },
    });
  }
};
