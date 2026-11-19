import { Router } from "express";
import {
  isAuthenticated,
  resolveAccountRole,
  verifyBearerToken,
} from "../auth/index.js";
import { largeJsonBody } from "../../middleware/json-body/json-body.middleware.js";
import { contentWriteLimiter } from "../../middleware/rate-limit/user-rate-limit.middleware.js";
import { validate } from "../../middleware/validate/validate.middleware.js";
import {
  createClientJobPost,
  editClientJobPost,
  getClientJobPost,
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
  clientJobRequest,
  clientJobsListRequest,
  createJobRequest,
  editJobRequest,
  publicJobFeedRequest,
  removeJobRequest,
  saveJobRequest,
  savedJobsRequest,
  unsaveJobRequest,
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
  validate({ ...createJobRequest, responses: jobsCreateResponses }),
  createClientJobPost,
);
jobRouter.get(
  "/",
  isAuthenticated,
  validate({ ...clientJobsListRequest, responses: jobsListResponses }),
  getClientJobPosts,
);
jobRouter.get(
  "/public",
  validate({ ...publicJobFeedRequest, responses: jobsPublicResponses }),
  getPublicJobFeedHandler,
);
jobRouter.get(
  "/saved",
  isAuthenticated,
  validate({ ...savedJobsRequest, responses: jobsSavedListResponses }),
  getFreelancerSavedJobPosts,
);
jobRouter.post(
  "/saved/:jobId",
  isAuthenticated,
  validate({ ...saveJobRequest, responses: jobsSaveResponses }),
  saveFreelancerJobPost,
);
jobRouter.delete(
  "/saved/:jobId",
  isAuthenticated,
  validate({ ...unsaveJobRequest, responses: jobsUnsaveResponses }),
  unsaveFreelancerJobPost,
);
jobRouter.get(
  "/:jobId",
  isAuthenticated,
  validate({ ...clientJobRequest, responses: jobsGetResponses }),
  getClientJobPost,
);
jobRouter.put(
  "/:jobId",
  verifyBearerToken,
  updateJobLimiter,
  largeJsonBody,
  resolveAccountRole,
  validate({ ...editJobRequest, responses: jobsUpdateResponses }),
  editClientJobPost,
);
jobRouter.delete(
  "/:jobId",
  isAuthenticated,
  validate({ ...removeJobRequest, responses: jobsDeleteResponses }),
  removeClientJobPost,
);
