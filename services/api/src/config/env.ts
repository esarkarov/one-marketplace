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

export const env = {
  port: parsePort(process.env.PORT),
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
} as const;
