const join = (...parts: string[]) => parts.join("_");

export const fakeStripeKey = (mode: "live" | "test", suffix: string) =>
  `${join("sk", mode)}_${suffix}`;

export const fakeWebhookSecret = (suffix: string) => join("whsec", suffix);
