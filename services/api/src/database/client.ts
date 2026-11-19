import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/config/env.js";
import { logger } from "@/config/logger.js";
import { errorMessageForLog } from "@/shared/logging/sanitize-log.js";
import {
  POOL_CONNECTION_TIMEOUT_MS,
  POOL_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  POOL_IDLE_TIMEOUT_MS,
  POOL_MAX_CLIENTS,
  POOL_STATEMENT_TIMEOUT_MS,
} from "./database.constants.js";

export const pool = new Pool({
  connectionString: env.databaseUrl,
  max: POOL_MAX_CLIENTS,
  connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS,
  idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
  statement_timeout: POOL_STATEMENT_TIMEOUT_MS,
  idle_in_transaction_session_timeout: POOL_IDLE_IN_TRANSACTION_TIMEOUT_MS,
});

pool.on("error", (error) => {
  void logger
    .error({
      message: "Idle database client failed",
      eventName: "database.pool.error",
      attributes: { "error.message": errorMessageForLog(error) },
    })
    .catch(() => undefined);
});

export const db = drizzle(pool);
