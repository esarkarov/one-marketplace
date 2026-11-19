import type { Request } from "express";
import { ApiError } from "@/shared/errors/api-error.js";

export const requireClient = (request: Request) => {
  if (!request.auth) throw new ApiError(401, "Authentication is required.");
  if (request.auth.role !== "client") {
    throw new ApiError(403, "A client account is required.");
  }
  return request.auth;
};

export const requireFreelancer = (request: Request) => {
  if (!request.auth) throw new ApiError(401, "Authentication is required.");
  if (request.auth.role !== "freelancer") {
    throw new ApiError(403, "A freelancer account is required.");
  }
  return request.auth;
};
