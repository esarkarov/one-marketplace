import {
  createClerkClient,
  verifyToken as clerkVerifyToken,
} from "@clerk/backend";
import { env } from "@/config/env.js";
import { createLazyClient } from "@/infrastructure/utils/lazy-client.utils.js";

export const clerk = createLazyClient(() =>
  createClerkClient({ secretKey: env.clerkSecretKey }),
);

export const verifyToken = (
  ...args: Parameters<typeof clerkVerifyToken>
): ReturnType<typeof clerkVerifyToken> => clerkVerifyToken(...args);
