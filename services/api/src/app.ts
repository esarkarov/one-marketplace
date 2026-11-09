import express from "express";
import cors from "cors";
import type { RequestHandler } from "express";
import { withOneMinuteLogs } from "@oneminutelogs/express";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { ApiResponse } from "./types/common.types.js";
import { API_PREFIX } from "./config/constants.js";
import { apiRouter } from "./routes/index.js";
import { notFoundHandler } from "./middleware/not-found.middleware.js";
import { errorHandler } from "./middleware/error.middleware.js";

export const app = express();

const requestLogger: RequestHandler = env.oneMinuteLogsApiKey
  ? withOneMinuteLogs(
      {
        apiKey: env.oneMinuteLogsApiKey,
        projectName: "OneMarketPlace",
        environment: env.nodeEnv,
      },
      { autoLogRequests: false },
    )
  : (request, _response, next) => {
      request.logger = logger;
      next();
    };

app.disable("x-powered-by");
app.use(
  `${API_PREFIX}/connects/webhook`,
  express.raw({ type: "application/json" }),
);
app.use(
  `${API_PREFIX}/contracts/webhook`,
  express.raw({ type: "application/json" }),
);
app.use(
  `${API_PREFIX}/identity/webhook`,
  express.raw({ type: "application/json" }),
);
app.use(
  `${API_PREFIX}/meetings/webhook`,
  express.raw({ type: "application/json" }),
);
app.use(requestLogger);

app.use(express.json({ limit: "20mb" }));
app.use(cors());
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
