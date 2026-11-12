import { RequestHandler } from "express";
import { ApiError } from "../../shared/http/api-error.js";
import { randomUUID } from "crypto";
import { asyncHandler } from "../../shared/http/async-handler.js";
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
import {
  requireClient,
  requireFreelancer,
} from "../../shared/http/role-guards.js";
import { MAX_JOB_BUDGET_CENTS, type JobBody } from "./jobs.schemas.js";
import {
  assertAttachmentFileName,
  validateAttachmentBatch,
} from "../../shared/utils/attachments.js";

const requireText = (value: string | string[] | undefined, name: string) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(400, `${name} is required.`);
  }
  return value.trim();
};

const buildJobData = (body: JobBody, allowStoredAttachments: boolean) => {
  const skills = Array.isArray(body.skills)
    ? body.skills
        .map(String)
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

  const milestones = Array.isArray(body.milestones)
    ? body.milestones.map((milestone) => {
        return {
          id: String(milestone.id || randomUUID()),
          title: requireText(milestone.title, "Milestone title"),
          budgetCents: milestone.budgetCents,
          dueDate: requireText(milestone.dueDate, "Milestone due date"),
        };
      })
    : [];

  if (!skills.length)
    throw new ApiError(400, "At least one skill is required.");
  if (!milestones.length) {
    throw new ApiError(400, "At least one milestone is required.");
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

  const total_budget_cents = milestones.reduce(
    (total, item) => total + item.budgetCents,
    0,
  );

  if (total_budget_cents < 500 || total_budget_cents > MAX_JOB_BUDGET_CENTS) {
    throw new ApiError(400, "Total budget must be between $5 and $1,000,000.");
  }

  const rawAttachments = Array.isArray(body.attachments)
    ? body.attachments.map((attachment) => ({
        fileId: typeof attachment.fileId === "string" ? attachment.fileId : "",
        fileName: requireText(attachment.fileName, "Attachment name"),
        fileUrl: requireText(attachment.fileUrl, "Attachment file"),
        fileType: requireText(attachment.fileType, "Attachment type"),
        fileSize: Number(attachment.fileSize) || 0,
      }))
    : [];

  rawAttachments.forEach(({ fileName }) => assertAttachmentFileName(fileName));

  const validated = validateAttachmentBatch(
    rawAttachments.map(({ fileName, fileUrl, fileType }) => ({
      fileName,
      fileUrl,
      mimeType: fileType,
    })),
    {
      tooManyMessage: "A job post can have up to 5 attachments.",
      nonDataMessage: allowStoredAttachments
        ? null
        : "Attachment URL is not allowed.",
    },
  );

  const attachments = rawAttachments.map((attachment, index) => {
    const result = validated[index];
    return result
      ? { ...attachment, fileType: result.mimeType, fileSize: result.size }
      : attachment;
  });

  return {
    title: requireText(body.title, "Job title"),
    description: requireText(body.description, "Job description"),
    expertise_level: requireText(body.expertise_level, "Expertise level"),
    expected_duration: requireText(body.expected_duration, "Expected duration"),
    skills,
    total_budget_cents,
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
    const data = buildJobData(request.body as JobBody, false);
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
    const data = buildJobData(request.body as JobBody, true);
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

export const getPublicJobFeedHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const query =
      typeof request.query.query === "string" ? request.query.query : "";
    const sort = (request.query.sort ?? "newest") as PublicJobFilters["sort"];
    const offset = Math.max(0, Number(request.query.offset) || 0);
    const numberParam = (key: string) => {
      const value = Number(request.query[key]);
      return Number.isSafeInteger(value) && value > 0 ? value : undefined;
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
      minBudgetCents: numberParam("minBudgetCents"),
      maxBudgetCents: numberParam("maxBudgetCents"),
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
