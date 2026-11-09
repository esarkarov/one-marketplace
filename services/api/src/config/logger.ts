import { createLogger } from "@oneminutelogs/express";

const apiKey = process.env.ONE_MINUTE_LOGS_API_KEY;

if (!apiKey) {
  throw new Error("ONE_MINUTE_LOGS_API_KEY is missing from the environment.");
}

export const logger = createLogger({
  apiKey,
  projectName: "OneMarketPlace",
  environment: process.env.NODE_ENV ?? "development",
});
