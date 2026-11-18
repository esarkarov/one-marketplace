import { toProposalInterviewResponse } from "../utils/proposals.mappers.js";
import { RequestHandler } from "express";
import type { z } from "zod";
import { asyncHandler } from "../../../middleware/utils/async-handler.utils.js";
import {
  requireClient,
  requireFreelancer,
} from "../../../middleware/auth/role-guards.middleware.js";
import { requireText } from "../../../config/constants.js";
import { ApiError } from "../../../shared/errors/api-error.js";
import type { submitProposalBodySchema } from "../schemas/proposals.schema.js";
import {
  getAgencyProposalMetadata,
  getAgencyProposals,
  getFreelancerProposalMetadata,
  getFreelancerProposals,
  getClientJobProposals,
} from "../services/proposals.queries.service.js";
import {
  updateProposal,
  shortlistProposal,
  startProposalInterview,
} from "../services/proposals.review.service.js";
import {
  submitAgencyProposal,
  submitProposal,
} from "../services/proposals.submission.service.js";
import {
  getAgencyIdForMember,
  requireAgencyPermission,
} from "../../agency/index.js";
import type { ApiResponse } from "../../../types/common.types.js";
import { sendNotification } from "../../../infrastructure/events/notification.publisher.js";

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

const pageOf = (request: Parameters<RequestHandler>[0]) => ({
  limit: Number(request.query.limit),
  offset: Number(request.query.offset),
});

export const getProposalMetadata: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireFreelancer(request);
    const metadata = await getFreelancerProposalMetadata(
      auth.userId,
      pageOf(request),
    );
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
            requireText(request.query.jobId as string | undefined, "Job post"),
            pageOf(request),
          )
        : await getFreelancerProposals(request.auth.userId, pageOf(request));
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

    const { recipient, response: proposal } = await updateProposal(
      requireText(request.params.proposalId, "Proposal"),
      auth.userId,
    );

    if (proposal.changed) {
      await sendNotification(
        recipient.senderType === "AGENCY"
          ? {
              agencyId: recipient.senderId,
              type: "PROPOSAL_VIEWED",
              title: "Your proposal was viewed",
              message: `A client viewed your proposal for “${proposal.jobTitle}”.`,
              link: "/proposals",
              metadata: { proposalId: proposal.id },
            }
          : {
              recipientId: recipient.senderId,
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
      data: toProposalInterviewResponse(result),
    });
  },
);

export const submitAgencyProposalHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    if (!request.auth) {
      throw new ApiError(401, "Authentication is required.");
    }

    if (request.auth.role !== "freelancer") {
      throw new ApiError(403, "A freelancer account is required.");
    }

    const { agencyId } = await requireAgencyPermission(
      request.auth.userId,
      "proposal.send",
    );
    if (!agencyId) {
      throw new ApiError(
        404,
        "No agency workspace was found for this account.",
      );
    }

    const coverLetter = requireText(request.body?.coverLetter, "Cover letter");
    const bidAmountCents = request.body.bidAmountCents as number;
    const screeningAnswers = Array.isArray(request.body?.screeningAnswers)
      ? request.body.screeningAnswers.map((answer: unknown) =>
          typeof answer === "string" ? answer.trim() : "",
        )
      : [];
    if (coverLetter.length < 80) {
      throw new ApiError(400, "Cover letter must be at least 80 characters.");
    }

    const result = await submitAgencyProposal(agencyId, {
      jobId: requireText(request.body?.jobId, "Job post"),
      coverLetter,
      bidAmountCents,
      duration: requireText(request.body?.duration, "Delivery duration"),
      screeningAnswers,
    });

    const body: ApiResponse<typeof result> = {
      success: true,
      message: "Proposal submitted.",
      data: result,
    };

    response.status(201).json(body);
  },
);

export const getAgencyProposalMetadataHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    if (!request.auth) {
      throw new ApiError(401, "Authentication is required.");
    }

    if (request.auth.role !== "freelancer") {
      throw new ApiError(403, "A freelancer account is required.");
    }

    const agencyId = await getAgencyIdForMember(request.auth.userId);
    const metadata = agencyId
      ? await getAgencyProposalMetadata(agencyId, pageOf(request))
      : {
          results: [],
          hasMore: false,
          counts: { total: 0, active: 0, viewed: 0, interviewed: 0 },
        };

    const body: ApiResponse<typeof metadata> = {
      success: true,
      message: "Proposal metadata retrieved.",
      data: metadata,
    };

    response.status(200).json(body);
  },
);

export const getAgencyProposalsHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    if (!request.auth) {
      throw new ApiError(401, "Authentication is required.");
    }

    if (request.auth.role !== "freelancer") {
      throw new ApiError(403, "A freelancer account is required.");
    }

    const agencyId = await getAgencyIdForMember(request.auth.userId);
    const proposals = agencyId
      ? await getAgencyProposals(agencyId, pageOf(request))
      : { results: [], hasMore: false };

    const body: ApiResponse<typeof proposals> = {
      success: true,
      message: "Proposals retrieved.",
      data: proposals,
    };

    response.status(200).json(body);
  },
);
