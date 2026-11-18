import ImageKit from "@imagekit/nodejs";
import { env } from "../../config/env.js";
import { createLazyClient } from "../utils/lazy-client.utils.js";

export const imageKit = createLazyClient(() => {
  if (!env.imageKitPrivateKey) {
    throw new Error("IMAGEKIT_PRIVATE_KEY is missing from the environment.");
  }

  return new ImageKit({ privateKey: env.imageKitPrivateKey });
});
