import { RequestHandler } from "express";
import { ApiError } from "../../../shared/errors/api-error.js";
import { getAgencyIdentityForOwner } from "../services/agency.profile.service.js";

export const requireAgencyAuth = (request: Parameters<RequestHandler>[0]) => {
  if (!request.auth) throw new ApiError(401, "Authentication is required.");
  if (request.auth.role !== "freelancer") {
    throw new ApiError(403, "A freelancer account is required.");
  }
  return request.auth;
};

export const requireAgencyOwner = async (userId: string) => {
  const agency = await getAgencyIdentityForOwner(userId);
  if (!agency) {
    throw new ApiError(403, "Only the agency owner can manage the team.");
  }
  return agency;
};
