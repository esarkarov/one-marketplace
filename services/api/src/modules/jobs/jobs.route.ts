import { Router } from "express";
import {
  isAuthenticated,
  resolveAccountRole,
  verifyBearerToken,
} from "../../middleware/auth.middleware.js";
import { largeJsonBody } from "../../middleware/json-body.middleware.js";
import { contentWriteLimiter } from "../../middleware/user-rate-limit.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { authRoleShape } from "../../utils/common-schemas.js";
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
  validate({ body: jobBodySchema, query: authRoleShape }),
  createClientJobPost,
);
jobRouter.get(
  "/",
  isAuthenticated,
  validate({ query: authRoleShape }),
  getClientJobPosts,
);
jobRouter.get(
  "/public",
  validate({ query: publicJobFeedQuerySchema }),
  getPublicJobFeedHandler,
);
jobRouter.get(
  "/saved",
  isAuthenticated,
  validate({ query: authRoleShape }),
  getFreelancerSavedJobPosts,
);
jobRouter.post(
  "/saved/:jobId",
  isAuthenticated,
  validate({ params: jobIdParamsSchema, query: authRoleShape }),
  saveFreelancerJobPost,
);
jobRouter.delete(
  "/saved/:jobId",
  isAuthenticated,
  validate({ params: jobIdParamsSchema, query: authRoleShape }),
  unsaveFreelancerJobPost,
);
jobRouter.get(
  "/:jobId",
  isAuthenticated,
  validate({ params: jobIdParamsSchema, query: authRoleShape }),
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
  }),
  editClientJobPost,
);
jobRouter.delete(
  "/:jobId",
  isAuthenticated,
  validate({ params: jobIdParamsSchema, query: authRoleShape }),
  removeClientJobPost,
);
