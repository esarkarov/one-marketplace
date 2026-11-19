import Stripe from "stripe";
import { env } from "@/config/env.js";
import { createLazyClient } from "@/infrastructure/utils/lazy-client.utils.js";
import { STRIPE_TIMEOUT_MS } from "@/infrastructure/constants/index.js";

export const stripe = createLazyClient(() => {
  if (!env.stripeSecretKey) {
    throw new Error("STRIPE_SECRET_KEY is missing from the environment.");
  }

  return new Stripe(env.stripeSecretKey, {
    timeout: STRIPE_TIMEOUT_MS,
  });
});
