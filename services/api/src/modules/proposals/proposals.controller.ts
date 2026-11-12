import { RequestHandler } from "express";
import type { z } from "zod";
import { asyncHandler } from "../../shared/http/async-handler.js";
import {
  requireClient,
  requireFreelancer,
} from "../../shared/http/role-guards.js";
import { requireText } from "../../config/constants.js";
import { ApiError } from "../../shared/http/api-error.js";
import type { submitProposalBodySchema } from "../../shared/validation/money-schemas.js";
import {
  getFreelancerProposalMetadata,
  getFreelancerProposals,
  getClientJobProposals,
  submitProposal,
  updateProposal,
  shortlistProposal,
  startProposalInterview,
} from "./proposals.service.js";
import { sendNotification } from "../../infrastructure/events/publisher.js";

export const createProposal: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireFreelancer(request);
    const body = request.body as z.infer<typeof submitProposalBodySchema>;

    const result = await submitProposal(auth.userId, {
      jobId: body.jobId,
      coverLetter: body.coverLetter,
      bidAmountCents: body.bidAmountCents,
      duration: body.duration,
      screeningAnswers: body.screeningAnswers ?? [],
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

    const message = request.body.message as string;

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
