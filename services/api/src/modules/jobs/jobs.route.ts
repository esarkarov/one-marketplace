import { Router } from "express";
import {
  isAuthenticated,
  resolveAccountRole,
  verifyBearerToken,
} from "../../shared/http/auth/auth.middleware.js";
import { largeJsonBody } from "../../shared/http/limits/json-body.middleware.js";
import { contentWriteLimiter } from "../../shared/http/limits/user-rate-limit.middleware.js";
import { validate } from "../../shared/http/validate.middleware.js";
import { authRoleShape } from "../../shared/validation/common-schemas.js";
import {
  createClientJobPost,
  editClientJobPost,
  getClientJobPosts,
  getFreelancerSavedJobPosts,
  getPublicJobFeedHandler,
  removeClientJobPost,
  saveFreelancerJobPost,
  unsaveFreelancerJobPost,
} from "./jobs.controller.js";
import {
  jobsCreateResponses,
  jobsDeleteResponses,
  jobsGetResponses,
  jobsListResponses,
  jobsPublicResponses,
  jobsSaveResponses,
  jobsSavedListResponses,
  jobsUnsaveResponses,
  jobsUpdateResponses,
} from "./jobs.responses.js";
import {
  jobBodySchema,
  jobIdParamsSchema,
  publicJobFeedQuerySchema,
} from "./jobs.schemas.js";

export const jobRouter = Router();

const createJobLimiter = contentWriteLimiter();
const updateJobLimiter = contentWriteLimiter();

jobRouter.post(
  "/",
  verifyBearerToken,
  createJobLimiter,
  largeJsonBody,
  resolveAccountRole,
  validate({
    body: jobBodySchema,
    query: authRoleShape,
    responses: jobsCreateResponses,
  }),
  createClientJobPost,
);
jobRouter.get(
  "/",
  isAuthenticated,
  validate({ query: authRoleShape, responses: jobsListResponses }),
  getClientJobPosts,
);
jobRouter.get(
  "/public",
  validate({
    query: publicJobFeedQuerySchema,
    responses: jobsPublicResponses,
  }),
  getPublicJobFeedHandler,
);
jobRouter.get(
  "/saved",
  isAuthenticated,
  validate({ query: authRoleShape, responses: jobsSavedListResponses }),
  getFreelancerSavedJobPosts,
);
jobRouter.post(
  "/saved/:jobId",
  isAuthenticated,
  validate({
    params: jobIdParamsSchema,
    query: authRoleShape,
    responses: jobsSaveResponses,
  }),
  saveFreelancerJobPost,
);
jobRouter.delete(
  "/saved/:jobId",
  isAuthenticated,
  validate({
    params: jobIdParamsSchema,
    query: authRoleShape,
    responses: jobsUnsaveResponses,
  }),
  unsaveFreelancerJobPost,
);
jobRouter.get(
  "/:jobId",
  isAuthenticated,
  validate({
    params: jobIdParamsSchema,
    query: authRoleShape,
    responses: jobsGetResponses,
  }),
  getClientJobPosts,
);
jobRouter.put(
  "/:jobId",
  verifyBearerToken,
  updateJobLimiter,
  largeJsonBody,
  resolveAccountRole,
  validate({
    params: jobIdParamsSchema,
    body: jobBodySchema,
    query: authRoleShape,
    responses: jobsUpdateResponses,
  }),
  editClientJobPost,
);
jobRouter.delete(
  "/:jobId",
  isAuthenticated,
  validate({
    params: jobIdParamsSchema,
    query: authRoleShape,
    responses: jobsDeleteResponses,
  }),
  removeClientJobPost,
);
