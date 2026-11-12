import { RequestHandler } from "express";
import { ApiError } from "./api-error.js";

export const requireClient = (request: Parameters<RequestHandler>[0]) => {
  if (!request.auth) throw new ApiError(401, "Authentication is required.");
  if (request.auth.role !== "client") {
    throw new ApiError(403, "A client account is required.");
  }
  return request.auth;
};

export const requireFreelancer = (request: Parameters<RequestHandler>[0]) => {
  if (!request.auth) throw new ApiError(401, "Authentication is required.");
  if (request.auth.role !== "freelancer") {
    throw new ApiError(403, "A freelancer account is required.");
  }
  return request.auth;
};
