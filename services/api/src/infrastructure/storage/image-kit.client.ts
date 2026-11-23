import ImageKit from "@imagekit/nodejs";
import { env } from "@/config/env.js";
import { IMAGEKIT_TIMEOUT_MS } from "@/infrastructure/constants/index.js";
import { createLazyClient } from "@/infrastructure/utils/lazy-client.utils.js";

export const imageKit = createLazyClient(() => {
  if (!env.imageKitPrivateKey) {
    throw new Error("IMAGEKIT_PRIVATE_KEY is missing from the environment.");
  }

  return new ImageKit({
    privateKey: env.imageKitPrivateKey,
    timeout: IMAGEKIT_TIMEOUT_MS,
    maxRetries: 0,
  });
});
