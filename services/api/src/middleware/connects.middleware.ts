import { RequestHandler } from "express";
import { asyncHandler } from "../utils/async-handler.js";
import { ApiError } from "../utils/api-error.js";
import {
  CONNECTS_CACHE_TTL_SECONDS,
  getConnectsCacheKey,
} from "../config/constants.js";
import { redis } from "../config/redis.js";
import { db } from "../database/client.js";
import { connects } from "../database/schema.js";
import { eq } from "drizzle-orm";

export const availableConnects: RequestHandler = asyncHandler(
  async (request, _response, next) => {
    if (!request.auth) throw new ApiError(401, "Authentication is required.");

    if (request.auth.role !== "freelancer") {
      next();
      return;
    }

    const cacheKey = getConnectsCacheKey(request.auth.userId);
    const cachedConnects = await redis.get(cacheKey);

    if (cachedConnects !== null) {
      request.availableConnects = Number(cachedConnects);
      await redis.expire(cacheKey, CONNECTS_CACHE_TTL_SECONDS);
      next();
      return;
    }

    const [balance] = await db
      .select({ connects: connects.connects })
      .from(connects)
      .where(eq(connects.freelancer_id, request.auth.userId))
      .limit(1);

    request.availableConnects = balance?.connects ?? 0;
    await redis.setEx(
      cacheKey,
      CONNECTS_CACHE_TTL_SECONDS,
      String(request.availableConnects),
    );

    next();
  },
);
