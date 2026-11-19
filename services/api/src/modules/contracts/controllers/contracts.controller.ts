import { RequestHandler } from "express";
import { ApiResponse } from "../../../types/common.types.js";
import { ApiError } from "../../../shared/errors/api-error.js";
import { asyncHandler } from "../../../middleware/utils/async-handler.utils.js";
import { getValidated } from "../../../middleware/utils/validated-request.utils.js";
import {
  requireClient,
  requireFreelancer,
} from "../../../middleware/auth/role-guards.middleware.js";
import {
  createContractCheckout,
  createMilestoneFundingCheckout,
} from "../services/contracts.checkout.service.js";
import {
  acceptContractRequest,
  addMilestoneRequest,
  clientContractsRequest,
  contractCheckoutRequest,
  declineContractRequest,
  finishContractRequest,
  freelancerContractsRequest,
  milestoneCheckoutRequest,
  reviewMilestoneRequest,
  submitMilestoneRequest,
  withdrawContractRequest,
} from "../schemas/contracts.schema.js";
import {
  getAccountContracts,
  getFreelancerAccountContracts,
} from "../services/contracts.listing.service.js";
import {
  acceptOffer,
  declineOffer,
  finishContractAsParty,
  withdrawOffer,
} from "../services/contracts.lifecycle.service.js";
import {
  addMilestone,
  reviewMilestone,
  submitMilestone,
} from "../services/contracts.milestones.service.js";
import { handleContractWebhook } from "../services/contracts.webhook.service.js";

export const startContractCheckout: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireClient(request);
    const { body } = getValidated(request, contractCheckoutRequest);
    const url = await createContractCheckout(auth.userId, body.proposalId);

    response.status(200).json({
      success: true,
      message: "Stripe Checkout created.",
      data: { url },
    } satisfies ApiResponse<{ url: string }>);
  },
);

export const startMilestoneFundingCheckout: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireClient(request);
    const { params, body } = getValidated(request, milestoneCheckoutRequest);
    const requirements = body.requirements ?? "";
    const url = await createMilestoneFundingCheckout(
      auth.userId,
      params.contractId,
      params.milestoneId,
      requirements || undefined,
    );
    response.status(200).json({
      success: true,
      message: "Milestone checkout created.",
      data: { url },
    });
  },
);

const pageOf = (query: { limit: number; offset: number }) => ({
  limit: query.limit,
  offset: query.offset,
});

export const getClientContracts: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireClient(request);
    const { query } = getValidated(request, clientContractsRequest);
    const contracts = await getAccountContracts(
      auth.userId,
      "client",
      null,
      pageOf(query),
    );
    response.status(200).json({
      success: true,
      message: "Client contracts retrieved.",
      data: contracts,
    });
  },
);

export const getFreelancerContracts: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireFreelancer(request);
    const { query } = getValidated(request, freelancerContractsRequest);
    const contracts = await getFreelancerAccountContracts(
      auth.userId,
      query.scope,
      pageOf(query),
    );
    response.status(200).json({
      success: true,
      message: "Freelancer contracts retrieved.",
      data: contracts,
    });
  },
);

export const acceptContractOffer: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireFreelancer(request);
    const { params, query } = getValidated(request, acceptContractRequest);
    const contract = await acceptOffer(
      auth.userId,
      params.contractId,
      query.scope,
    );
    response.status(200).json({
      success: true,
      message: "Contract offer accepted.",
      data: { contractId: contract.id, status: "ACTIVE" },
    });
  },
);

export const declineContractOffer: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireFreelancer(request);
    const { params, query } = getValidated(request, declineContractRequest);
    const contract = await declineOffer(
      auth.userId,
      params.contractId,
      query.scope,
    );
    response.status(200).json({
      success: true,
      message: contract.alreadyCancelled
        ? "Contract cancelled."
        : "Contract offer declined.",
      data: { contractId: contract.id, status: contract.status },
    });
  },
);

export const withdrawContractOffer: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireClient(request);
    const { params } = getValidated(request, withdrawContractRequest);
    const contract = await withdrawOffer(auth.userId, params.contractId);
    response.status(200).json({
      success: true,
      message: contract.alreadyCancelled
        ? "Contract cancelled."
        : "Contract offer withdrawn.",
      data: { contractId: contract.id, status: contract.status },
    });
  },
);

export const submitMilestoneWork: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireFreelancer(request);
    const { params, query, body } = getValidated(
      request,
      submitMilestoneRequest,
    );
    const milestone = await submitMilestone(
      auth.userId,
      params.contractId,
      params.milestoneId,
      query.scope,
      body.submissionMessage,
      body.submissionDeliveryLink,
    );

    response.status(200).json({
      success: true,
      message: "Milestone submitted for review.",
      data: {
        milestoneId: milestone.milestoneId,
        paymentRequestedAt: new Date(),
      },
    });
  },
);

export const reviewMilestoneWork: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireClient(request);
    const { params, body } = getValidated(request, reviewMilestoneRequest);
    const milestone = await reviewMilestone(
      auth.userId,
      params.contractId,
      params.milestoneId,
      body.action,
      body.feedback,
    );

    response.status(200).json({
      success: true,
      message: milestone.approved
        ? "Milestone work accepted."
        : "Modifications requested.",
      data: { milestoneId: milestone.milestoneId },
    });
  },
);

export const createAdditionalMilestone: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireClient(request);
    const { params, body } = getValidated(request, addMilestoneRequest);
    const milestone = await addMilestone(auth.userId, params.contractId, {
      title: body.title,
      amountCents: body.amountCents,
      dueDate: body.dueDate,
    });
    response.status(201).json({
      success: true,
      message: "Milestone added.",
      data: milestone,
    });
  },
);

export const finishContract: RequestHandler = asyncHandler(
  async (request, response) => {
    if (!request.auth) throw new ApiError(401, "Authentication is required.");
    const role = request.auth.role;
    if (role !== "client" && role !== "freelancer") {
      throw new ApiError(403, "A marketplace account is required.");
    }
    const { params, query, body } = getValidated(
      request,
      finishContractRequest,
    );

    const contract = await finishContractAsParty(
      request.auth.userId,
      role,
      params.contractId,
      query.scope,
      body.rating,
      body.comment,
    );

    response.status(200).json({
      success: true,
      message: contract.newlyCompleted
        ? "Contract completed and review submitted."
        : "Review submitted.",
      data: { contractId: contract.id, status: "COMPLETED" },
    });
  },
);

export const contractWebhook: RequestHandler = asyncHandler(
  async (request, response) => {
    await handleContractWebhook(request);

    response.status(200).json({ received: true });
  },
);
