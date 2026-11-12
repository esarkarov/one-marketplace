import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OPTIONAL_VARIABLES = [
  "RABBITMQ_URL",
  "CLERK_SECRET_KEY",
  "IMAGEKIT_PRIVATE_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_CONNECTS_WEBHOOK_SECRET",
  "STRIPE_IDENTITY_WEBHOOK_SECRET",
  "DAILY_API_KEY",
  "DAILY_WEBHOOK_SECRET",
  "ADMIN_DASHBOARD_PASSWORD",
  "ADMIN_SESSION_SECRET",
  "CLIENT_DASHBOARD",
  "FREELANCER_DASHBOARD",
  "AGENCY_DASHBOARD",
  "ADMIN_DASHBOARD",
  "TRUST_PROXY",
  "PORT",
];

for (const name of OPTIONAL_VARIABLES) delete process.env[name];
process.env.NODE_ENV = "development";
process.env.DATABASE_URL = "postgres://localhost:5432/openapi_generate";
process.env.REDIS_URL = "redis://localhost:6379";

try {
  const { apiRouter } = await import("../routes/index.js");
  const { OPENAPI_FILE, createOpenApiText } = await import("./document.js");

  const text = createOpenApiText(apiRouter);
  const file = fileURLToPath(OPENAPI_FILE);
  mkdirSync(fileURLToPath(new URL(".", OPENAPI_FILE)), { recursive: true });
  writeFileSync(file, text, { encoding: "utf8" });
  process.stdout.write(`Wrote ${file}\n`);
  process.exit(0);
} catch (error) {
  process.stderr.write(
    `OpenAPI generation failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}
