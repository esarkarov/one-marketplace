import { toProposalInterviewResponse } from "../utils/proposals.mappers.js";
import { RequestHandler } from "express";
import { asyncHandler } from "../../../middleware/utils/async-handler.utils.js";
import { getValidated } from "../../../middleware/utils/validated-request.utils.js";
import {
  agencyProposalMetadataRequest,
  agencyProposalsRequest,
  createProposalRequest,
  interviewProposalRequest,
  listProposalsRequest,
  proposalMetadataRequest,
  submitAgencyProposalRequest,
  updateProposalStatusRequest,
} from "../schemas/proposals.schema.js";
import {
  requireClient,
  requireFreelancer,
} from "../../../middleware/auth/role-guards.middleware.js";
import { requireText } from "../../../shared/validation/utils/require-text.utils.js";
import { ApiError } from "../../../shared/errors/api-error.js";
import {
  getAgencyProposalMetadata,
  getAgencyProposals,
  getFreelancerProposalMetadata,
  getFreelancerProposals,
  getClientJobProposals,
} from "../services/proposals.queries.service.js";
import {
  markProposalViewed,
  shortlistProposal,
  startInterview,
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

export const createProposal: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireFreelancer(request);

    const { body } = getValidated(request, createProposalRequest);
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

const pageOf = (query: { limit: number; offset: number }) => ({
  limit: query.limit,
  offset: query.offset,
});

export const getProposalMetadata: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireFreelancer(request);
    const { query } = getValidated(request, proposalMetadataRequest);
    const metadata = await getFreelancerProposalMetadata(
      auth.userId,
      pageOf(query),
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
    const { query } = getValidated(request, listProposalsRequest);
    const proposals =
      request.auth.role === "client"
        ? await getClientJobProposals(
            request.auth.userId,
            requireText(query.jobId, "Job post"),
            pageOf(query),
          )
        : await getFreelancerProposals(request.auth.userId, pageOf(query));
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

    const { params, body } = getValidated(request, updateProposalStatusRequest);
    const proposalId = requireText(params.proposalId, "Proposal");
    if (body.isShortlisted === true) {
      const proposal = await shortlistProposal(proposalId, auth.userId);
      response.status(200).json({
        success: true,
        message: "Proposal shortlisted.",
        data: proposal,
      });
      return;
    }

    const proposal = await markProposalViewed(
      requireText(params.proposalId, "Proposal"),
      auth.userId,
    );

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

    const { params, body } = getValidated(request, interviewProposalRequest);
    const message = body.message;

    const result = await startInterview(
      requireText(params.proposalId, "Proposal"),
      request.auth.userId,
      message,
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

    const { body: input } = getValidated(request, submitAgencyProposalRequest);
    const coverLetter = requireText(input.coverLetter, "Cover letter");
    const bidAmountCents = input.bidAmountCents;
    const screeningAnswers = Array.isArray(input.screeningAnswers)
      ? input.screeningAnswers.map((answer: unknown) =>
          typeof answer === "string" ? answer.trim() : "",
        )
      : [];
    if (coverLetter.length < 80) {
      throw new ApiError(400, "Cover letter must be at least 80 characters.");
    }

    const result = await submitAgencyProposal(agencyId, {
      jobId: requireText(input.jobId, "Job post"),
      coverLetter,
      bidAmountCents,
      duration: requireText(input.duration, "Delivery duration"),
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
    const { query } = getValidated(request, agencyProposalMetadataRequest);
    const metadata = agencyId
      ? await getAgencyProposalMetadata(agencyId, pageOf(query))
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
    const { query } = getValidated(request, agencyProposalsRequest);
    const proposals = agencyId
      ? await getAgencyProposals(agencyId, pageOf(query))
      : { results: [], hasMore: false };

    const body: ApiResponse<typeof proposals> = {
      success: true,
      message: "Proposals retrieved.",
      data: proposals,
    };

    response.status(200).json(body);
  },
);
