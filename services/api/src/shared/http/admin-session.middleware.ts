import { createHmac, timingSafeEqual } from "crypto";
import { RequestHandler } from "express";
import { asyncHandler } from "./async-handler.js";
import { ApiError } from "./api-error.js";
import { env } from "../../config/env.js";

const verifyToken = (token: string | undefined, secret: string): boolean => {
  if (!token) return false;
  const [expiresAtRaw, signature] = token.split(".");
  if (!expiresAtRaw || !signature) return false;

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;

  const expected = createHmac("sha256", secret)
    .update(expiresAtRaw)
    .digest("hex");
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(signature);
  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  );
};

const getBearerToken = (authorizationHeader: string | undefined) => {
  if (!authorizationHeader?.startsWith("Bearer ")) return undefined;
  return authorizationHeader.slice("Bearer ".length).trim() || undefined;
};

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
