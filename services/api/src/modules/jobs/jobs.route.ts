import { Router } from "express";
import {
  isAuthenticated,
  resolveAccountRole,
  verifyBearerToken,
} from "../auth/index.js";
import { largeJsonBody } from "../../middleware/json-body/json-body.middleware.js";
import { contentWriteLimiter } from "../../middleware/rate-limit/user-rate-limit.middleware.js";
import { validate } from "../../middleware/validate/validate.middleware.js";
import { authRoleShape } from "../../shared/validation/schemas/common.schema.js";
import { roleListQuerySchema } from "../../shared/validation/schemas/pagination.schema.js";
import {
  createClientJobPost,
  editClientJobPost,
  getClientJobPosts,
  getFreelancerSavedJobPosts,
  getPublicJobFeedHandler,
  removeClientJobPost,
  saveFreelancerJobPost,
  unsaveFreelancerJobPost,
} from "./controllers/jobs.controller.js";
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
} from "./responses/jobs.responses.js";
import {
  jobBodySchema,
  jobIdParamsSchema,
  publicJobFeedQuerySchema,
} from "./schemas/jobs.schema.js";

export const jobRouter = Router();

const createJobLimiter = contentWriteLimiter("job-create");
const updateJobLimiter = contentWriteLimiter("job-update");

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
  validate({ query: roleListQuerySchema, responses: jobsListResponses }),
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
  validate({ query: roleListQuerySchema, responses: jobsSavedListResponses }),
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
