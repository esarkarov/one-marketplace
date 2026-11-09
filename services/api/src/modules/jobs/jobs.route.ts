import { Router } from "express";
import {
  isAuthenticated,
  resolveAccountRole,
  verifyBearerToken,
} from "../../middleware/auth.middleware.js";
import { largeJsonBody } from "../../middleware/json-body.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
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
  emptyQuerySchema,
  jobBodySchema,
  jobIdParamsSchema,
  publicJobFeedQuerySchema,
} from "./jobs.schemas.js";

export const jobRouter = Router();

jobRouter.post(
  "/",
  verifyBearerToken,
  largeJsonBody,
  resolveAccountRole,
  validate({ body: jobBodySchema, query: emptyQuerySchema }),
  createClientJobPost,
);
jobRouter.get(
  "/",
  isAuthenticated,
  validate({ query: emptyQuerySchema }),
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
  validate({ query: emptyQuerySchema }),
  getFreelancerSavedJobPosts,
);
jobRouter.post(
  "/saved/:jobId",
  isAuthenticated,
  validate({ params: jobIdParamsSchema, query: emptyQuerySchema }),
  saveFreelancerJobPost,
);
jobRouter.delete(
  "/saved/:jobId",
  isAuthenticated,
  validate({ params: jobIdParamsSchema, query: emptyQuerySchema }),
  unsaveFreelancerJobPost,
);
jobRouter.get(
  "/:jobId",
  isAuthenticated,
  validate({ params: jobIdParamsSchema, query: emptyQuerySchema }),
  getClientJobPosts,
);
jobRouter.put(
  "/:jobId",
  verifyBearerToken,
  largeJsonBody,
  resolveAccountRole,
  validate({
    params: jobIdParamsSchema,
    body: jobBodySchema,
    query: emptyQuerySchema,
  }),
  editClientJobPost,
);
jobRouter.delete(
  "/:jobId",
  isAuthenticated,
  validate({ params: jobIdParamsSchema, query: emptyQuerySchema }),
  removeClientJobPost,
);
