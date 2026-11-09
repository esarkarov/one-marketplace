import Stripe from "stripe";
import { env } from "./env.js";

let instance: Stripe | undefined;

export const stripe = new Proxy({} as Stripe, {
  get: (_target, property) => {
    instance ??= new Stripe(env.stripeSecretKey ?? "");
    return Reflect.get(instance, property, instance);
  },
});
