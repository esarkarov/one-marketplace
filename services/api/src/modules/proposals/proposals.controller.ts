import { RequestHandler } from "express";
import { asyncHandler } from "../../utils/async-handler.js";
import { requireFreelancer } from "../freelancer/freelancer.controller.js";
import { requireText } from "../../config/constants.js";
import { ApiError } from "../../utils/api-error.js";
import {
  getFreelancerProposalMetadata,
  getFreelancerProposals,
  getClientJobProposals,
  submitProposal,
  updateProposal,
  shortlistProposal,
  startProposalInterview,
} from "./proposals.service.js";
import { sendNotification } from "../../events/publisher.js";

export const requireClient = (request: Parameters<RequestHandler>[0]) => {
  if (!request.auth) throw new ApiError(401, "Authentication is required.");
  if (request.auth.role !== "client") {
    throw new ApiError(403, "A client account is required.");
  }
  return request.auth;
};

export const createProposal: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireFreelancer(request);
    const coverLetter = requireText(request.body?.coverLetter, "Cover letter");
    const bidAmount = Number(request.body?.bidAmount);
    const screeningAnswers = Array.isArray(request.body?.screeningAnswers)
      ? request.body.screeningAnswers.map((answer: unknown) =>
          typeof answer === "string" ? answer.trim() : "",
        )
      : [];
    if (coverLetter.length < 80)
      throw new ApiError(400, "Cover letter must be at least 80 characters.");
    if (
      !Number.isFinite(bidAmount) ||
      bidAmount <= 0 ||
      bidAmount > 1_000_000
    ) {
      throw new ApiError(400, "Enter a valid bid amount.");
    }

    const result = await submitProposal(auth.userId, {
      jobId: requireText(request.body?.jobId, "Job post"),
      coverLetter,
      bidAmount,
      duration: requireText(request.body?.duration, "Delivery duration"),
      screeningAnswers,
    });

    response.status(201).json({
      success: true,
      message: "Proposal submitted.",
      data: result,
    });
  },
);

export const getProposalMetadata: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireFreelancer(request);
    const metadata = await getFreelancerProposalMetadata(auth.userId);
    response.status(200).json({
      success: true,
      message: "Proposal metadata retrieved.",
      data: metadata,
    });
  },
);

export const getProposals: RequestHandler = asyncHandler(
  async (request, response) => {
    if (!request.auth) throw new ApiError(401, "Authentication is required.");
    const proposals =
      request.auth.role === "client"
        ? await getClientJobProposals(
            request.auth.userId,
            requireText(request.query.jobId as any, "Job post"),
          )
        : await getFreelancerProposals(request.auth.userId);
    response.status(200).json({
      success: true,
      message: "Proposals retrieved.",
      data: proposals,
    });
  },
);

export const updateProposalStatus: RequestHandler = asyncHandler(
  async (request, response) => {
    if (!request.auth) throw new ApiError(401, "Authentication is required.");
    const auth = requireClient(request);

    const proposalId = requireText(request.params.proposalId, "Proposal");
    if (request.body?.isShortlisted === true) {
      const proposal = await shortlistProposal(proposalId, auth.userId);
      response.status(200).json({
        success: true,
        message: "Proposal shortlisted.",
        data: proposal,
      });
      return;
    }

    const proposal = await updateProposal(
      requireText(request.params.proposalId, "Proposal"),
      auth.userId,
    );

    if (proposal.changed) {
      await sendNotification(
        proposal.senderType === "AGENCY"
          ? {
              agencyId: proposal.senderId,
              type: "PROPOSAL_VIEWED",
              title: "Your proposal was viewed",
              message: `A client viewed your proposal for “${proposal.jobTitle}”.`,
              link: "/proposals",
              metadata: { proposalId: proposal.id },
            }
          : {
              recipientId: proposal.senderId,
              type: "PROPOSAL_VIEWED",
              title: "Your proposal was viewed",
              message: `A client viewed your proposal for “${proposal.jobTitle}”.`,
              link: "/my-proposals",
              metadata: { proposalId: proposal.id },
            },
      );
    }

    response.status(200).json({
      success: true,
      message: "Proposal marked as viewed.",
      data: proposal,
    });
  },
);

export const interviewProposal: RequestHandler = asyncHandler(
  async (request, response) => {
    if (!request.auth || request.auth.role !== "client") {
      throw new ApiError(403, "A client account is required.");
    }

    const message = requireText(request.body?.message, "Interview message");
    if (message.length > 5_000) {
      throw new ApiError(
        400,
        "Interview message cannot exceed 5,000 characters.",
      );
    }

    const result = await startProposalInterview(
      requireText(request.params.proposalId, "Proposal"),
      request.auth.userId,
      message,
    );

    await sendNotification(
      result.senderType === "AGENCY" && result.agencyId
        ? {
            agencyId: result.agencyId,
            type: "PROPOSAL_INTERVIEWED",
            title: "You received an interview",
            message: `A client started an interview for “${result.jobTitle}”.`,
            link: `/messages?conversationId=${result.conversationId}`,
            metadata: {
              proposalId: result.proposalId,
              conversationId: result.conversationId,
            },
          }
        : {
            recipientId: result.freelancerId,
            type: "PROPOSAL_INTERVIEWED",
            title: "You received an interview",
            message: `A client started an interview for “${result.jobTitle}”.`,
            link: `/messages?conversationId=${result.conversationId}`,
            metadata: {
              proposalId: result.proposalId,
              conversationId: result.conversationId,
            },
          },
    );

    response.status(201).json({
      success: true,
      message: "Interview started.",
      data: result,
    });
  },
);
