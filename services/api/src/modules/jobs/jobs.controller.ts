import { RequestHandler } from "express";
import { ApiError } from "../../utils/api-error.js";
import { randomUUID } from "crypto";
import { asyncHandler } from "../../utils/async-handler.js";
import {
  createJobPost,
  deleteJobPost,
  getJobPosts,
  getPublicJobFeed,
  getSavedJobPosts,
  PublicJobFeedPage,
  PublicJobFilters,
  removeSavedJobPost,
  saveJobPost,
  updateJobPost,
} from "./jobs.service.js";
import { requireFreelancer } from "../freelancer/freelancer.controller.js";

const requireClient = (request: Parameters<RequestHandler>[0]) => {
  const auth = request.auth!;

  if (auth.role !== "client") {
    throw new ApiError(403, "A client account is required.");
  }

  return auth;
};

const requireText = (value: string | string[] | undefined, name: string) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(400, `${name} is required.`);
  }
  return value.trim();
};

const buildJobData = (body: Record<string, any>) => {
  const skills = Array.isArray(body.skills)
    ? body.skills
        .map(String)
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

  const milestones = Array.isArray(body.milestones)
    ? body.milestones.map((item) => {
        const milestone = item as Record<string, any>;
        return {
          id: String(milestone.id || randomUUID()),
          title: requireText(milestone.title, "Milestone title"),
          budget: Number(milestone.budget),
          dueDate: requireText(milestone.dueDate, "Milestone due date"),
        };
      })
    : [];

  if (!skills.length)
    throw new ApiError(400, "At least one skill is required.");
  if (!milestones.length) {
    throw new ApiError(400, "At least one milestone is required.");
  }
  if (
    milestones.some(({ budget }) => !Number.isFinite(budget) || budget <= 5)
  ) {
    throw new ApiError(400, "Every milestone needs a valid budget.");
  }

  const dates = milestones.map(({ dueDate }) => new Date(dueDate).getTime());
  if (
    dates.some(
      (date, index) =>
        !Number.isFinite(date) ||
        date <= Date.now() ||
        (index > 0 && date <= dates[index - 1]!),
    )
  ) {
    throw new ApiError(
      400,
      "Milestone due dates must be future and sequential.",
    );
  }

  const total_budget = milestones.reduce(
    (total, item) => total + item.budget,
    0,
  );

  if (total_budget < 5 || total_budget > 1_000_000) {
    throw new ApiError(400, "Total budget must be between $5 and $1,000,000.");
  }

  const attachments = Array.isArray(body.attachments)
    ? body.attachments.map((item) => {
        const attachment = item as Record<string, string>;
        const fileType = requireText(attachment.fileType, "Attachment type");
        const fileUrl = requireText(attachment.fileUrl, "Attachment file");

        if (fileType !== "application/pdf" && !fileType.startsWith("text/")) {
          throw new ApiError(400, "Only PDF and text documents are allowed.");
        }
        if (
          fileUrl.startsWith("data:") &&
          !fileUrl.startsWith(`data:${fileType}`)
        ) {
          throw new ApiError(
            400,
            "Attachment content does not match its file type.",
          );
        }

        return {
          fileId:
            typeof attachment.fileId === "string" ? attachment.fileId : "",
          fileName: requireText(attachment.fileName, "Attachment name"),
          fileUrl,
          fileType,
          fileSize: Number(attachment.fileSize) || 0,
        };
      })
    : [];

  return {
    title: requireText(body.title, "Job title"),
    description: requireText(body.description, "Job description"),
    expertise_level: requireText(body.expertise_level, "Expertise level"),
    expected_duration: requireText(body.expected_duration, "Expected duration"),
    skills,
    total_budget: total_budget.toString(),
    milestones,
    screening_questions: Array.isArray(body.screening_questions)
      ? body.screening_questions
          .map(String)
          .map((item) => item.trim())
          .filter(Boolean)
      : [],
    attachments,
    status: body.status === "DRAFT" ? "DRAFT" : "PUBLISHED",
  };
};

export const createClientJobPost: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireClient(request);
    const data = buildJobData(request.body as Record<string, any>);
    const job = await createJobPost(auth.userId, {
      ...data,
      published_at: data.status === "PUBLISHED" ? new Date() : null,
    });

    if (job) {
      await request.logger.info({
        message: "Job post created",
        eventName: "order.job_post.created",
        attributes: {
          "order.job_post.id": job.id,
          "user.id": auth.userId,
          "order.job_post.status": job.status,
        },
      });
    }

    response
      .status(201)
      .json({ success: true, message: "Job post created.", data: job });
  },
);

export const getClientJobPosts: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireClient(request);
    const jobId =
      typeof request.params.jobId === "string"
        ? request.params.jobId
        : undefined;
    const jobs = await getJobPosts(auth.userId, jobId);
    response.status(200).json({
      success: true,
      message: "Job posts retrived.",
      data: jobId ? (jobs[0] ?? null) : jobs,
    });
  },
);

export const editClientJobPost: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireClient(request);
    const data = buildJobData(request.body as Record<string, unknown>);
    const job = await updateJobPost(
      auth.userId,
      requireText(request.params.jobId, "Job post id"),
      data,
    );
    await request.logger.info({
      message: "Job post updated",
      eventName: "order.job_post.updated",
      attributes: {
        "order.job_post.id": job.id,
        "user.id": auth.userId,
        "order.job_post.status": job.status,
      },
    });
    response
      .status(200)
      .json({ success: true, message: "Job post updated.", data: job });
  },
);

export const removeClientJobPost: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireClient(request);
    const job = await deleteJobPost(
      auth.userId,
      requireText(request.params.jobId, "Job post id"),
    );
    await request.logger.info({
      message: "Job post deleted",
      eventName: "order.job_post.deleted",
      attributes: {
        "order.job_post.id": job.id,
        "user.id": auth.userId,
        "order.job_post.status": job.status,
      },
    });
    response.status(200).json({ success: true, message: "Job post deleted." });
  },
);

export const saveFreelancerJobPost: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireFreelancer(request);
    const savedJob = await saveJobPost(
      auth.userId,
      requireText(request.params.jobId, "Job post id"),
    );
    response.status(201).json({
      success: true,
      message: "Job post saved.",
      data: savedJob,
    });
  },
);

export const getFreelancerSavedJobPosts: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireFreelancer(request);
    const jobs = await getSavedJobPosts(auth.userId);
    response.status(200).json({
      success: true,
      message: "Saved job posts retrieved.",
      data: jobs,
    });
  },
);

const JOB_SORT_VALUES = ["newest", "budget", "rating", "proposals"];

export const getPublicJobFeedHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const query =
      typeof request.query.query === "string" ? request.query.query : "";
    const sort =
      typeof request.query.sort === "string" &&
      JOB_SORT_VALUES.includes(request.query.sort)
        ? (request.query.sort as PublicJobFilters["sort"])
        : "newest";
    const offset = Math.max(0, Number(request.query.offset) || 0);
    const numberParam = (key: string) => {
      const value = Number(request.query[key]);
      return Number.isFinite(value) && value > 0 ? value : undefined;
    };
    const levels =
      typeof request.query.levels === "string" && request.query.levels
        ? request.query.levels.split(",").filter(Boolean)
        : undefined;

    const filters: PublicJobFilters = {
      query,
      sort,
      levels,
      paymentVerified: request.query.paymentVerified === "true",
      minBudget: numberParam("minBudget"),
      maxBudget: numberParam("maxBudget"),
      maxProposals:
        request.query.maxProposals !== undefined
          ? Number(request.query.maxProposals)
          : undefined,
    };

    const page = await getPublicJobFeed(filters, { offset });
    const responseBody = {
      success: true,
      message: "Job feed retrieved.",
      data: page satisfies PublicJobFeedPage,
    };

    response.status(200).json(responseBody);
  },
);

export const unsaveFreelancerJobPost: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireFreelancer(request);
    const savedJob = await removeSavedJobPost(
      auth.userId,
      requireText(request.params.jobId, "Job post id"),
    );
    response.status(200).json({
      success: true,
      message: "Job post removed from saved jobs.",
      data: savedJob,
    });
  },
);
