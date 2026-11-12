import {
  createClerkClient,
  verifyToken as clerkVerifyToken,
} from "@clerk/backend";
import { env } from "../config/env.js";

let instance: ReturnType<typeof createClerkClient> | undefined;

export const clerk = new Proxy({} as ReturnType<typeof createClerkClient>, {
  get: (_target, property) => {
    instance ??= createClerkClient({ secretKey: env.clerkSecretKey });
    return Reflect.get(instance, property, instance);
  },
});

export const verifyToken = (
  ...args: Parameters<typeof clerkVerifyToken>
): ReturnType<typeof clerkVerifyToken> => clerkVerifyToken(...args);
