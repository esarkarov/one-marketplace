import type { Request, RequestHandler } from "express";
import { asyncHandler } from "./async-handler.js";
import { ApiError } from "./api-error.js";
import { env } from "../../config/env.js";
import { allowedOrigins } from "../../config/cors.js";
import {
  ACCOUNT_AUTH_CACHE_TTL_SECONDS,
  ACCOUNT_AUTH_NEGATIVE_CACHE_TTL_SECONDS,
  getAccountAuthCacheKey,
} from "../../config/constants.js";
import { verifyToken } from "../../infrastructure/clerk.js";
import { redis } from "../../infrastructure/redis.js";
import { db } from "../../database/client.js";
import { accounts } from "../../database/schema.js";
import { and, eq } from "drizzle-orm";

const accountRoles = ["client", "freelancer"] as const;
type AccountRole = (typeof accountRoles)[number];

interface AuthClaims {
  userId: string;
  sessionId?: string | undefined;
}

interface CachedAccountAuth {
  userId: string;
  role: "client" | "freelancer";
  accountExists: boolean;
  isOnboarded: boolean;
}

const isAccountRole = (value: unknown): value is AccountRole =>
  typeof value === "string" &&
  accountRoles.some((accountRole) => accountRole === value);

export const getBearerToken = (authorizationHeader: string | undefined) => {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authorizationHeader?.slice("Bearer ".length).trim();
  return token || null;
};

const isAccountAvailable = async (
  requestedRole: "client" | "freelancer",
  userId: string,
): Promise<CachedAccountAuth> => {
  const cacheKey = getAccountAuthCacheKey(userId, requestedRole);
  const cachedValue = await redis.get(cacheKey);

  if (cachedValue) {
    return JSON.parse(cachedValue) as CachedAccountAuth;
  }

  const databaseRole = requestedRole === "client" ? "CLIENT" : "FREELANCER";

  const [account] = await db
    .select({ isOnboardingComplete: accounts.isOnboardingComplete })
    .from(accounts)
    .where(and(eq(accounts.auth_id, userId), eq(accounts.role, databaseRole)))
    .limit(1);

  const accountAuth: CachedAccountAuth = {
    userId,
    accountExists: Boolean(account),
    role: requestedRole,
    isOnboarded: account?.isOnboardingComplete === true,
  };

  await redis.setEx(
    cacheKey,
    accountAuth.accountExists
      ? ACCOUNT_AUTH_CACHE_TTL_SECONDS
      : ACCOUNT_AUTH_NEGATIVE_CACHE_TTL_SECONDS,
    JSON.stringify(accountAuth),
  );

  return accountAuth;
};

export const authenticateAccount = async (
  token: unknown,
  requestedRole: unknown,
) => {
  if (typeof token !== "string" || !token) {
    throw new ApiError(401, "Authentication token is required.");
  }
  if (!isAccountRole(requestedRole)) {
    throw new ApiError(400, "A valid account role is required.");
  }
  if (!env.clerkSecretKey) {
    throw new ApiError(503, "Authentication is not configured.");
  }

  try {
    const claims = await verifyToken(token, {
      secretKey: env.clerkSecretKey,
      authorizedParties: allowedOrigins,
    });
    return {
      ...(await isAccountAvailable(requestedRole, claims.sub)),
      sessionId: typeof claims.sid === "string" ? claims.sid : undefined,
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(401, "Authentication token is invalid or expired.");
  }
};

const requireBearerToken = (request: Request) => {
  const token = getBearerToken(request?.headers.authorization);

  if (!token) {
    throw new ApiError(401, "Please do login to access this API!");
  }

  return token;
};

const readRequestedRole = (request: Request): AccountRole => {
  const requestedRole = request.body?.role ?? request?.query.role;

  if (!isAccountRole(requestedRole)) {
    throw new ApiError(400, "A valid account role is required.");
  }

  return requestedRole;
};

const verifyClaims = async (token: string): Promise<AuthClaims> => {
  try {
    const claims = await verifyToken(token, {
      secretKey: env.clerkSecretKey,
      authorizedParties: allowedOrigins,
    });

    return {
      userId: claims.sub,
      sessionId: typeof claims.sid === "string" ? claims.sid : undefined,
    };
  } catch {
    throw new ApiError(401, "Authentication token is invalid or expired.");
  }
};

const loadRequestAuth = async (
  claims: AuthClaims,
  requestedRole: AccountRole,
) => {
  const accountAuth = await isAccountAvailable(requestedRole, claims.userId);

  return {
    userId: claims.userId,
    sessionId: claims.sessionId,
    role: requestedRole,
    accountExists: accountAuth.accountExists,
    isOnboarded: accountAuth.isOnboarded,
  };
};

const authenticateRequest = (requireAccount: boolean): RequestHandler =>
  asyncHandler(async (request, _response, next) => {
    const token = getBearerToken(request?.headers.authorization);
    const requestedRole = request.body?.role ?? request?.query.role;

    if (!token) {
      throw new ApiError(401, "Please do login to access this API!");
    }

    if (!isAccountRole(requestedRole)) {
      throw new ApiError(400, "A valid account role is required.");
    }

    const claims = await verifyClaims(token);
    const auth = await loadRequestAuth(claims, requestedRole);

    if (requireAccount && !auth.accountExists) {
      throw new ApiError(403, "An account for this role is required.");
    }

    request.auth = auth;
    next();
  });

export const isAuthenticated = authenticateRequest(true);

export const identifyAccount = authenticateRequest(false);

export const verifyBearerToken: RequestHandler = asyncHandler(
  async (request, _response, next) => {
    request.authClaims = await verifyClaims(requireBearerToken(request));
    next();
  },
);

export const resolveAccountRole: RequestHandler = asyncHandler(
  async (request, _response, next) => {
    if (!request.authClaims) {
      throw new ApiError(401, "Please do login to access this API!");
    }

    const auth = await loadRequestAuth(
      request.authClaims,
      readRequestedRole(request),
    );

    if (!auth.accountExists) {
      throw new ApiError(403, "An account for this role is required.");
    }

    request.auth = auth;
    next();
  },
);
