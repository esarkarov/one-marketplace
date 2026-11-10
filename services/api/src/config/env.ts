import { z } from "zod";

type Source = Record<string, string | undefined>;

const emptyToUndefined = (value: unknown) => (value === "" ? undefined : value);

const optionalString = z.preprocess(
  emptyToUndefined,
  z.string({ error: "must be a string" }).optional(),
);

const requiredUrl = (protocols: RegExp, description: string) =>
  z
    .string({ error: "is required" })
    .min(1, "is required")
    .regex(protocols, `must be a ${description} URL`);

const dashboardUrl = (name: string) =>
  z.preprocess(
    emptyToUndefined,
    z
      .string({ error: `${name} must be a valid URL.` })
      .refine((value) => URL.canParse(value), `${name} must be a valid URL.`)
      .optional(),
  );

const port = z
  .preprocess(emptyToUndefined, z.string().optional())
  .transform((value, ctx) => {
    const parsed = Number(value ?? 4000);

    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
      ctx.issues.push({
        code: "custom",
        message: "PORT must be an integer between 1 and 65535.",
        input: value,
      });
      return z.NEVER;
    }

    return parsed;
  });

const trustProxy = z
  .string()
  .optional()
  .transform((value, ctx): boolean | number | string => {
    const trimmed = value?.trim() ?? "";

    if (trimmed === "" || trimmed === "false" || trimmed === "0") {
      return false;
    }

    if (/^true$/i.test(trimmed)) {
      ctx.issues.push({
        code: "custom",
        message:
          "TRUST_PROXY=true trusts any client-supplied X-Forwarded-For; use a hop count or subnet list",
        input: value,
      });
      return z.NEVER;
    }

    if (/^\d+$/.test(trimmed)) {
      return Number(trimmed);
    }

    return trimmed;
  });

const requiredToStart = z.object({
  DATABASE_URL: requiredUrl(
    /^postgres(ql)?:\/\//,
    "postgres:// or postgresql://",
  ),
  REDIS_URL: requiredUrl(/^rediss?:\/\//, "redis:// or rediss://"),
});

const optionalFeatures = z.object({
  PORT: port,
  NODE_ENV: z.preprocess(
    emptyToUndefined,
    z.string({ error: "must be a string" }).default("development"),
  ),
  TRUST_PROXY: trustProxy,
  RABBITMQ_URL: z.preprocess(
    emptyToUndefined,
    z
      .string({ error: "must be a string" })
      .regex(/^amqps?:\/\//, "must be an amqp:// or amqps:// URL")
      .optional(),
  ),
  CLERK_SECRET_KEY: optionalString,
  IMAGEKIT_PRIVATE_KEY: optionalString,
  STRIPE_SECRET_KEY: optionalString,
  STRIPE_WEBHOOK_SECRET: optionalString,
  STRIPE_CONNECTS_WEBHOOK_SECRET: optionalString,
  STRIPE_IDENTITY_WEBHOOK_SECRET: optionalString,
  DAILY_API_KEY: optionalString,
  DAILY_WEBHOOK_SECRET: optionalString,
  ADMIN_DASHBOARD_PASSWORD: optionalString,
  ADMIN_SESSION_SECRET: optionalString,
  CLIENT_DASHBOARD: dashboardUrl("CLIENT_DASHBOARD"),
  FREELANCER_DASHBOARD: dashboardUrl("FREELANCER_DASHBOARD"),
  AGENCY_DASHBOARD: dashboardUrl("AGENCY_DASHBOARD"),
  ADMIN_DASHBOARD: dashboardUrl("ADMIN_DASHBOARD"),
});

const describe = (issues: z.core.$ZodIssue[]): string[] =>
  issues.map((issue) => {
    const name = String(issue.path[0] ?? "environment");
    return `- ${name}: ${issue.message}`;
  });

export const parseEnv = (source: Source) => {
  const required = requiredToStart.safeParse(source);
  const optional = optionalFeatures.safeParse(source);

  if (!required.success || !optional.success) {
    const sections: string[] = [];

    if (!required.success) {
      sections.push(
        [
          "Missing or invalid required variables:",
          ...describe(required.error.issues),
        ].join("\n"),
      );
    }

    if (!optional.success) {
      sections.push(
        [
          "Invalid optional variables:",
          ...describe(optional.error.issues),
        ].join("\n"),
      );
    }

    throw new Error(sections.join("\n"));
  }

  const r = required.data;
  const o = optional.data;

  return {
    port: o.PORT,
    trustProxy: o.TRUST_PROXY,
    nodeEnv: o.NODE_ENV,
    databaseUrl: r.DATABASE_URL,
    redisUrl: r.REDIS_URL,
    rabbitmqUrl: o.RABBITMQ_URL,
    clerkSecretKey: o.CLERK_SECRET_KEY,
    imageKitPrivateKey: o.IMAGEKIT_PRIVATE_KEY,
    stripeSecretKey: o.STRIPE_SECRET_KEY,
    stripeWebhookSecret: o.STRIPE_WEBHOOK_SECRET,
    stripeConnectsWebhookSecret: o.STRIPE_CONNECTS_WEBHOOK_SECRET,
    stripeIdentityWebhookSecret: o.STRIPE_IDENTITY_WEBHOOK_SECRET,
    dailyApiKey: o.DAILY_API_KEY,
    dailyWebhookSecret: o.DAILY_WEBHOOK_SECRET,
    adminDashboardPassword: o.ADMIN_DASHBOARD_PASSWORD,
    adminSessionSecret: o.ADMIN_SESSION_SECRET,
    freelancerDashboard: o.FREELANCER_DASHBOARD,
    clientDashboard: o.CLIENT_DASHBOARD,
    agencyDashboard: o.AGENCY_DASHBOARD,
    adminDashboard: o.ADMIN_DASHBOARD,
  } as const;
};

export const env = parseEnv(process.env);
