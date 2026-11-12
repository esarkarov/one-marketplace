import { createClerkClient } from "@clerk/backend";
import { env } from "../config/env.js";

let instance: ReturnType<typeof createClerkClient> | undefined;

export const clerk = new Proxy({} as ReturnType<typeof createClerkClient>, {
  get: (_target, property) => {
    instance ??= createClerkClient({ secretKey: env.clerkSecretKey });
    return Reflect.get(instance, property, instance);
  },
});
