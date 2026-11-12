import { fileURLToPath } from "node:url";
import { assertTestDatabase } from "./assert-test-database.js";

process.env.NODE_ENV = "test";

try {
  process.loadEnvFile(
    fileURLToPath(new URL("../../../../../.env", import.meta.url)),
  );
} catch {}

if (process.env.RABBITMQ_URL) {
  process.env.INTEGRATION_RABBITMQ_URL = process.env.RABBITMQ_URL;
}

for (const name of [
  "RABBITMQ_URL",
  "CLERK_SECRET_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_CONNECTS_WEBHOOK_SECRET",
  "STRIPE_IDENTITY_WEBHOOK_SECRET",
  "IMAGEKIT_PRIVATE_KEY",
  "DAILY_API_KEY",
  "DAILY_WEBHOOK_SECRET",
  "CLIENT_DASHBOARD",
  "FREELANCER_DASHBOARD",
  "AGENCY_DASHBOARD",
  "ADMIN_DASHBOARD",
  "TRUST_PROXY",
]) {
  delete process.env[name];
}

process.env.ADMIN_DASHBOARD_PASSWORD = "test-admin-password";
process.env.ADMIN_SESSION_SECRET = "test-admin-session-secret";

const assertLocal = (name: string) => {
  const value = process.env[name];
  let hostname = "";

  try {
    hostname = value ? new URL(value).hostname : "";
  } catch {}

  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    throw new Error(
      `${name} must point to localhost. Tests only run against local Docker.`,
    );
  }
};

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

assertLocal("DATABASE_URL");
assertLocal("REDIS_URL");
assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);
