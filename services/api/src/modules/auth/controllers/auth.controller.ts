import { RequestHandler } from "express";
import { ApiError } from "@/shared/errors/api-error.js";
import { ApiResponse } from "@/types/common.types.js";
import { asyncHandler } from "@/middleware/utils/async-handler.utils.js";
import { getValidated } from "@/middleware/utils/validated-request.utils.js";
import { signUpRequest } from "@/modules/auth/schemas/auth.schema.js";
import { receiveSignup } from "@/modules/auth/services/auth.service.js";
import {
  authenticateAccount,
  getBearerToken,
} from "@/modules/auth/middleware/auth.middleware.js";

interface AuthStatusData {
  role: "client" | "freelancer";
  accountExists: boolean;
  accountId: string | null;
  isOnboarded: boolean;
}

export const getAuthStatus: RequestHandler = (request, response) => {
  if (!request.auth) {
    throw new ApiError(401, "Authentication is required.");
  }

  const body: ApiResponse<AuthStatusData> = {
    success: true,
    message: "Authentication status retrieved.",
    data: {
      role: request.auth.role,
      accountExists: request.auth.accountExists,
      accountId: request.auth.accountId,
      isOnboarded: request.auth.isOnboarded,
    },
  };

  response.status(200).json(body);
};

export const signup: RequestHandler = asyncHandler(
  async (request, response) => {
    let auth: Awaited<ReturnType<typeof authenticateAccount>>;
    let accountId: string | null = null;
    const token = getBearerToken(request.headers.authorization);
    const requestedRole = getValidated(request, signUpRequest).body.role;

    try {
      auth = await authenticateAccount(token, requestedRole);
      accountId = auth.accountId ?? null;
      if (!auth.accountExists) {
        accountId = await receiveSignup(auth);
      }
    } catch (error) {
      await request.logger.warn({
        message: "User signup failed",
        eventName: "auth.signup.failed",
        attributes: {
          "auth.failure_kind":
            error instanceof ApiError ? error.message : "unknown",
        },
      });
      throw error;
    }

    if (!auth.accountExists) {
      await request.logger.info({
        message: "User signed up",
        eventName: "auth.signup.succeeded",
        attributes: {
          "user.id": auth.userId,
        },
      });
    }

    const body: ApiResponse<AuthStatusData> = {
      success: true,
      message: "Signup data received.",
      data: {
        role: auth.role,
        accountExists: auth.accountExists,
        accountId,
        isOnboarded: auth.isOnboarded,
      },
    };

    response.status(201).json(body);
  },
);
