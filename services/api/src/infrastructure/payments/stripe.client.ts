import Stripe from "stripe";
import { env } from "../../config/env.js";
import { createLazyClient } from "../utils/lazy-client.utils.js";
import { STRIPE_TIMEOUT_MS } from "../constants/index.js";

export const stripe = createLazyClient(
  () =>
    new Stripe(env.stripeSecretKey ?? "", {
      timeout: STRIPE_TIMEOUT_MS,
    }),
);
