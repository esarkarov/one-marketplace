import { RequestHandler } from "express";
import { asyncHandler } from "../../shared/http/async-handler.js";
import { ApiError } from "../../shared/http/api-error.js";
import {
  CONNECTS_CACHE_TTL_SECONDS,
  getConnectsCacheKey,
} from "../../config/constants.js";
import { redis } from "../../infrastructure/redis.js";
import { db } from "../../database/client.js";
import { findFreelancerConnectsBalance } from "./connects.repository.js";

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

    const balance = await findFreelancerConnectsBalance(
      db,
      request.auth.userId,
    );

    request.availableConnects = balance?.connects ?? 0;
    await redis.setEx(
      cacheKey,
      CONNECTS_CACHE_TTL_SECONDS,
      String(request.availableConnects),
    );

    next();
  },
);
