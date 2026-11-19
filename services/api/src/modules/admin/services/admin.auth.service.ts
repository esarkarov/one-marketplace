import { createHash, timingSafeEqual } from "node:crypto";
import type { AppLogger } from "@/config/logger.js";
import { env } from "@/config/env.js";
import { ApiError } from "@/shared/errors/api-error.js";
import { signToken } from "@/middleware/utils/admin-session.utils.js";

const digest = (value: string) => createHash("sha256").update(value).digest();

const passwordsMatch = (provided: string, expected: string) =>
  timingSafeEqual(digest(provided), digest(expected));

export const loginAdmin = async (
  password: string,
  clientAddress: string | undefined,
  logger: AppLogger,
) => {
  if (!env.adminDashboardPassword || !env.adminSessionSecret) {
    throw new ApiError(503, "Admin authentication is not configured.");
  }

  if (!passwordsMatch(password, env.adminDashboardPassword)) {
    await logger.warn({
      message: "Admin sign-in failed",
      eventName: "auth.login.failed",
      attributes: {
        "auth.method": "password",
        "auth.failure_kind": "invalid_credentials",
        "client.address": clientAddress ?? "unknown",
      },
    });
    throw new ApiError(401, "Incorrect password.");
  }

  await logger.info({
    message: "Admin signed in",
    eventName: "auth.login.succeeded",
    attributes: {
      "auth.method": "password",
      "client.address": clientAddress ?? "unknown",
    },
  });

  return signToken(env.adminSessionSecret);
};
