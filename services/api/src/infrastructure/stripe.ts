import Stripe from "stripe";
import { env } from "../config/env.js";

let instance: Stripe | undefined;

export const STRIPE_TIMEOUT_MS = 30_000;

export const stripe = new Proxy({} as Stripe, {
  get: (_target, property) => {
    instance ??= new Stripe(env.stripeSecretKey ?? "", {
      timeout: STRIPE_TIMEOUT_MS,
    });
    return Reflect.get(instance, property, instance);
  },
});
