import type { RequestHandler } from "express";
import { asyncHandler } from "../utils/async-handler.utils.js";
import { ApiError } from "../../shared/errors/api-error.js";
import { env } from "../../config/env.js";
import { getBearerToken, verifyToken } from "../utils/admin-session.utils.js";

const createAdminSessionGuard = (allowQueryToken: boolean): RequestHandler =>
  asyncHandler(async (request, _response, next) => {
    if (!env.adminSessionSecret) {
      throw new ApiError(503, "Admin authentication is not configured.");
    }

    const token =
      getBearerToken(request.headers.authorization) ??
      (allowQueryToken && typeof request.query.token === "string"
        ? request.query.token
        : undefined);

    if (!verifyToken(token, env.adminSessionSecret)) {
      await request.logger.warn({
        message: "Admin session rejected",
        eventName: "security.authorization.rejected",
        attributes: {
          "http.route": request.path,
          "client.address": request.ip ?? "unknown",
        },
      });
      throw new ApiError(401, "Admin session is missing or expired.");
    }

    next();
  });

export const requireAdminSession = createAdminSessionGuard(false);
export const requireAdminSessionAllowingQueryToken =
  createAdminSessionGuard(true);
