import { Router } from "express";
import { isAuthenticated } from "../../middleware/auth.middleware.js";
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

export const jobRouter = Router();

jobRouter.post("/", isAuthenticated, createClientJobPost);
jobRouter.get("/", isAuthenticated, getClientJobPosts);
jobRouter.get("/public", getPublicJobFeedHandler);
jobRouter.get("/saved", isAuthenticated, getFreelancerSavedJobPosts);
jobRouter.post("/saved/:jobId", isAuthenticated, saveFreelancerJobPost);
jobRouter.delete("/saved/:jobId", isAuthenticated, unsaveFreelancerJobPost);
jobRouter.get("/:jobId", isAuthenticated, getClientJobPosts);
jobRouter.put("/:jobId", isAuthenticated, editClientJobPost);
jobRouter.delete("/:jobId", isAuthenticated, removeClientJobPost);
