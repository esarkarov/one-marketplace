import { RequestHandler } from "express";
import { ApiError } from "../../utils/api-error.js";
import { ApiResponse } from "../../types/common.types.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { receiveSignup } from "./auth.service.js";
import {
  authenticateAccount,
  getBearerToken,
} from "../../middleware/auth.middleware.js";

interface AuthStatusData {
  role: "client" | "freelancer";
  accountExists: boolean;
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
      isOnboarded: request.auth.isOnboarded,
    },
  };

  response.status(200).json(body);
};

export const signup: RequestHandler = asyncHandler(
  async (request, response) => {
    let auth: Awaited<ReturnType<typeof authenticateAccount>>;
    const token = getBearerToken(request.headers.authorization);
    const requestedRole = request.body?.role;

    try {
      auth = await authenticateAccount(token, requestedRole);
      if (!auth.accountExists) {
        await receiveSignup(auth);
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
        isOnboarded: auth.isOnboarded,
      },
    };

    response.status(201).json(body);
  },
);
