import express from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "./config/env.js";
import { corsOptions } from "./config/cors.js";
import { ApiResponse } from "./types/common.types.js";
import { API_PREFIX } from "./config/constants.js";
import { WEBHOOK_PATHS } from "./config/webhooks.js";
import { apiRouter } from "./routes/index.js";
import { notFoundHandler } from "./middleware/not-found.middleware.js";
import { errorHandler } from "./middleware/error.middleware.js";
import { createHttpLogger } from "./middleware/http-logger.middleware.js";
import { requestIdMiddleware } from "./middleware/request-id.middleware.js";
import { jsonBody } from "./middleware/json-body.middleware.js";
import { globalLimiter } from "./middleware/rate-limit.middleware.js";

export const app = express();

app.disable("x-powered-by");
app.set("trust proxy", env.trustProxy);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(requestIdMiddleware);
for (const path of WEBHOOK_PATHS) {
  app.use(`${API_PREFIX}${path}`, express.raw({ type: "application/json" }));
}
app.use(createHttpLogger());

app.use(cors(corsOptions));
app.use(API_PREFIX, globalLimiter);
app.use(jsonBody);
app.use(express.urlencoded({ extended: true }));

app.get("/", (_request, response) => {
  const body: ApiResponse<never> = {
    success: true,
    message: "OneMarketplace.io API is running.",
  };

  response.status(200).json(body);
});

app.use(API_PREFIX, apiRouter);
app.use(notFoundHandler);
app.use(errorHandler);
