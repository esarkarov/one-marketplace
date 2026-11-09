import "dotenv/config";

const parseRedisDatabase = (value: string | undefined): number => {
  const database = Number(value ?? 0);

  if (!Number.isInteger(database) || database < 0) {
    throw new Error("REDIS_DB must be a non-negative integer.");
  }

  return database;
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
  clerkSecretKey: process.env.CLERK_SECRET_KEY,
  nodeEnv: process.env.NODE_ENV || "development",
  redis: {
    host: process.env.REDIS_HOST ?? "localhost",
    port: parsePort(process.env.REDIS_PORT ?? "6379"),
    password: process.env.REDIS_PASSWORD || undefined,
    database: parseRedisDatabase(process.env.REDIS_DB),
  },
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
  natsUrl: process.env.NATS_URL ?? "nats://localhost:4222",
} as const;
