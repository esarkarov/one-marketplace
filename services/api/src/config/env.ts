const required = (name: string): string => {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required. Set it in the root .env file.`);
  }

  return value;
};

const parsePort = (value: string | undefined): number => {
  const port = Number(value ?? 4000);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  return port;
};

const parseTrustProxy = (
  value: string | undefined,
): boolean | number | string => {
  const trimmed = value?.trim() ?? "";

  if (trimmed === "" || trimmed === "false" || trimmed === "0") {
    return false;
  }

  if (/^true$/i.test(trimmed)) {
    throw new Error(
      "TRUST_PROXY=true trusts any client-supplied X-Forwarded-For; use a hop count or subnet list",
    );
  }

  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }

  return trimmed;
};

export const env = {
  port: parsePort(process.env.PORT),
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  nodeEnv: process.env.NODE_ENV || "development",
  databaseUrl: required("DATABASE_URL"),
  redisUrl: required("REDIS_URL"),
  natsUrl: process.env.NATS_URL || undefined,
  clerkSecretKey: process.env.CLERK_SECRET_KEY,
  imageKitPrivateKey: process.env.IMAGEKIT_PRIVATE_KEY,
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  stripeConnectsWebhookSecret: process.env.STRIPE_CONNECTS_WEBHOOK_SECRET,
  stripeIdentityWebhookSecret: process.env.STRIPE_IDENTITY_WEBHOOK_SECRET,
  dailyApiKey: process.env.DAILY_API_KEY,
  dailyWebhookSecret: process.env.DAILY_WEBHOOK_SECRET,
  oneMinuteLogsApiKey: process.env.ONE_MINUTE_LOGS_API_KEY,
  adminDashboardPassword: process.env.ADMIN_DASHBOARD_PASSWORD,
  adminSessionSecret: process.env.ADMIN_SESSION_SECRET,
  freelancerDashboard: process.env.FREELANCER_DASHBOARD,
  clientDashboard: process.env.CLIENT_DASHBOARD,
  agencyDashboard: process.env.AGENCY_DASHBOARD,
  adminDashboard: process.env.ADMIN_DASHBOARD,
} as const;
